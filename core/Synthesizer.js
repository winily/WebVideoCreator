import path from "path";
import assert from "assert";
import EventEmitter from "eventemitter3";
import fs from "fs-extra";
import { PassThrough } from "stream";
import ffmpegPath from "ffmpeg-static";
import { path as ffprobePath } from "ffprobe-static";
import ffmpeg from "fluent-ffmpeg";
import uniqid from "uniqid";
import cliProgress from "cli-progress";
import _ from "lodash";

import {
    SUPPORT_FORMAT, FORMAT_VIDEO_ENCODER_MAP,
    FORMAT_AUDIO_ENCODER_MAP, VIDEO_ENCODER_MAP, AUDIO_ENCODER_MAP
} from "../lib/const.js";
import globalConfig from "../lib/global-config.js";
import Audio from "../entity/Audio.js";
import logger from "../lib/logger.js";
import util from "../lib/util.js";

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

/** @typedef {import('fluent-ffmpeg').FfmpegCommand} FfmpegCommand */

/**
 * 序列帧合成器
 */
export default class Synthesizer extends EventEmitter {

    /** 合成器状态枚举 */
    static STATE = {
        /** 已就绪 */
        READY: Symbol("READY"),
        /** 合成中 */
        SYNTHESIZING: Symbol("SYNTHESIZING"),
        /** 已完成 */
        COMPLETED: Symbol("COMPLETED")
    };

    /** @type {string} - 合成器ID */
    id = uniqid("video_");
    /** @type {Synthesizer.STATE} - 合成器状态 */
    state = Synthesizer.STATE.READY;
    /** @type {number} - 合成进度 */
    progress = 0;
    /** 合成对象名称 */
    name = null;
    /** @type {string} - 导出视频路径 */
    outputPath;
    /** @type {number} - 视频合成帧率 */
    fps;
    /** @type {number} - 视频宽度 */
    width;
    /** @type {number} - 视频高度 */
    height;
    /** @type {number} - 视频时长 */
    duration;
    /** @type {string} - 视频格式（mp4/webm） */
    format;
    /** @type {string} - 附加到视频首帧的封面路径 */
    attachCoverPath;
    /** @type {boolean} - 是否捕获封面并输出*/
    coverCapture;
    /** @type {number} - 封面捕获时间点（毫秒）*/
    coverCaptureTime;
    /** @type {string} - 封面捕获格式（jpg/png/bmp） */
    coverCaptureFormat;
    /** @type {string} - 视频编码器 */
    videoEncoder;
    /** @type {number} - 视频质量（0-100） */
    videoQuality;
    /** @type {string} - 视频码率（如8M，设置码率将忽略videoQuality） */
    videoBitrate;
    /** @type {string} - 像素格式（yuv420p/yuv444p/rgb24） */
    pixelFormat;
    /** @type {string} - 音频编码器（aac/ogg） */
    audioEncoder;
    /** @type {string} - 音频码率 */
    audioBitrate;
    /** @type {numer} - 视频音量（0-100） */
    volume;
    /** @type {numer} - 并行写入帧数 */
    parallelWriteFrames;
    /** @type {boolean} - 背景不透明度（0-1）仅webm格式支持 */
    backgroundOpacity;
    /** @type {boolean} - 是否在命令行展示进度 */
    showProgress;
    /** @type {Audio[]} - 音频列表 */
    audios = [];
    /** @type {string} - 临时路径 */
    tmpDirPath = path.resolve("tmp/synthesizer/");
    /** @type {number} - 启动时间点 */
    _startupTime = null;
    /** @protected @type {string} - 交换文件路径 */
    _swapFilePath;
    /** @type {number} - 帧计数 */
    _frameCount = 0;
    /** @protected @type {cliProgress.SingleBar|cliProgress.MultiBar} - cli进度 */
    _cliProgress = null;
    /** @protected @type {number} - 目标帧数 */
    _targetFrameCount = 0;
    /** @type {Buffer[]} - 帧缓冲区列表 */
    #frameBuffers = null;
    /** @type {Buffer[]} - 帧缓冲区指针 */
    #frameBufferIndex = 0;
    /** @type {PassThrough} - 帧写入管道流 */
    #pipeStream = null;
    /** @type {FfmpegCommand} - 当前编码器 */
    #encoder = null;

    /**
     * 构造函数
     * 
     * @param {Object} options - 序列帧合成器选项
     * @param {string} options.outputPath - 导出视频路径
     * @param {number} options.width - 视频宽度
     * @param {number} options.height - 视频高度
     * @param {number} options.duration - 视频时长
     * @param {number} [options.fps=30] - 视频合成帧率
     * @param {string} [options.format] - 导出视频格式（mp4/webm）
     * @param {string} [options.attachCoverPath] - 附加到视频首帧的封面路径
     * @param {string} [options.coverCapture=false] - 是否捕获封面并输出
     * @param {number} [options.coverCaptureTime] - 封面捕获时间点（毫秒）
     * @param {string} [options.coverCaptureFormat="jpg"] - 封面捕获格式（jpg/png/bmp）
     * @param {string} [options.videoEncoder="libx264"] - 视频编码器
     * @param {number} [options.videoQuality=100] - 视频质量（0-100）
     * @param {string} [options.videoBitrate] - 视频码率（设置码率将忽略videoQuality）
     * @param {string} [options.pixelFormat="yuv420p"] - 像素格式（yuv420p/yuv444p/rgb24）
     * @param {string} [options.audioEncoder="aac"] - 音频编码器
     * @param {string} [options.audioBitrate] - 音频码率
     * @param {number} [options.volume=100] - 视频音量（0-100）
     * @param {number} [options.parallelWriteFrames=10] - 并行写入帧数
     * @param {boolean} [options.backgroundOpacity=1] - 背景不透明度（0-1），仅webm格式支持
     * @param {boolean} [options.showProgress=false] - 是否在命令行展示进度
     */
    constructor(options) {
        super();
        assert(_.isObject(options), "Synthesizer options must be object");
        const { width, height, fps, duration, format, outputPath,
            attachCoverPath, coverCapture, coverCaptureTime, coverCaptureFormat,
            videoEncoder, videoQuality, videoBitrate, pixelFormat, audioEncoder,
            audioBitrate, volume, parallelWriteFrames, backgroundOpacity, showProgress } = options;
        assert(_.isFinite(width) && width % 2 === 0, "width must be even number");
        assert(_.isFinite(height) && height % 2 === 0, "height must be even number");
        assert(_.isFinite(duration), "synthesis duration must be number");
        assert(_.isString(outputPath) || this._isVideoChunk(), "outputPath must be string");
        assert(_.isUndefined(fps) || _.isFinite(fps), "synthesis fps must be number");
        assert(_.isUndefined(format) || SUPPORT_FORMAT.includes(format), `format ${format} is not supported`);
        assert(_.isUndefined(attachCoverPath) || _.isString(attachCoverPath), "attachCoverPath must be string");
        assert(_.isUndefined(coverCapture) || _.isBoolean(coverCapture), "coverCapture must be boolean");
        assert(_.isUndefined(coverCaptureTime) || _.isFinite(coverCaptureTime), "coverCaptureTime must be number");
        assert(_.isUndefined(coverCaptureFormat) || _.isString(coverCaptureFormat), "coverCaptureFormat must be string");
        assert(_.isUndefined(videoEncoder) || _.isString(videoEncoder), "videoEncoder must be string");
        assert(_.isUndefined(videoQuality) || _.isFinite(videoQuality), "videoQuality must be number");
        assert(_.isUndefined(videoBitrate) || _.isString(videoBitrate), "videoBitrate must be string");
        assert(_.isUndefined(pixelFormat) || _.isString(pixelFormat), "pixelFormat must be string");
        assert(_.isUndefined(audioEncoder) || _.isString(audioEncoder), "audioEncoder must be string");
        assert(_.isUndefined(audioBitrate) || _.isString(audioBitrate), "audioBitrate must be string");
        assert(_.isUndefined(volume) || _.isFinite(volume), "volume must be number");
        assert(_.isUndefined(parallelWriteFrames) || _.isFinite(parallelWriteFrames), "parallelWriteFrames must be number");
        assert(_.isUndefined(backgroundOpacity) || _.isFinite(backgroundOpacity), "backgroundOpacity must be number");
        assert(_.isUndefined(showProgress) || _.isBoolean(showProgress), "showProgress must be boolean")
        if (!format && outputPath && !this._isVideoChunk()) {
            const _format = path.extname(outputPath).substring(1);
            if (!_format)
                throw new Error(`Unable to recognize output video format: ${outputPath}`);
            if (!SUPPORT_FORMAT.includes(_format))
                throw new Error(`Unsupported output video format: ${_format}`);
            this.format = _format;
        }
        else if (format)
            this.format = format;
        else
            this.format = SUPPORT_FORMAT[0];
        this.width = width;
        this.height = height;
        this.fps = _.defaultTo(fps, 30);
        this.duration = duration;
        this.outputPath = _.isString(outputPath) ? path.resolve(outputPath) : outputPath;
        this.name = this.outputPath ? path.basename(this.outputPath) : null;
        this.attachCoverPath = _.isString(attachCoverPath) ? path.resolve(attachCoverPath) : attachCoverPath;
        this.coverCapture = _.defaultTo(coverCapture, false);
        this.coverCaptureTime = coverCaptureTime;
        this.coverCaptureFormat = _.defaultTo(coverCaptureFormat, "jpg");
        this.videoEncoder = _.defaultTo(videoEncoder, _.defaultTo(this.format == "webm" ? globalConfig.webmEncoder : globalConfig.mp4Encoder, FORMAT_VIDEO_ENCODER_MAP[this.format][0] || "libx264"));
        this.videoQuality = _.defaultTo(videoQuality, 100);
        this.videoBitrate = videoBitrate;
        this.audioEncoder = _.defaultTo(audioEncoder, _.defaultTo(globalConfig.audioEncoder, FORMAT_AUDIO_ENCODER_MAP[this.format][0] || "aac"));
        this.audioBitrate = audioBitrate;
        this.volume = _.defaultTo(volume, 100);
        this.parallelWriteFrames = _.defaultTo(parallelWriteFrames, 10);
        this.backgroundOpacity = _.defaultTo(backgroundOpacity, 1);
        this.pixelFormat = _.defaultTo(pixelFormat, this.hasAlphaChannel ? "yuva420p" : "yuv420p");
        this.showProgress = _.defaultTo(showProgress, false);
        this.#frameBuffers = new Array(this.parallelWriteFrames);
        this._swapFilePath = path.join(this.tmpDirPath, `${uniqid("video_")}.${this.format}`);
        this._targetFrameCount = util.durationToFrameCount(this.duration, this.fps);
        if (this.showProgress) {
            this._cliProgress = new cliProgress.SingleBar({
                hideCursor: true,
                format: `[${"{bar}".green}] {percentage}% | {value}/{total} | {eta_formatted} | {filename}`,
            }, cliProgress.Presets.shades_grey);
        }
    }

    /**
     * 启动合成
     */
    start() {
        if (!this.#pipeStream)
            this.#pipeStream = new PassThrough();
        assert(this.isReady(), "Synthesizer status is not READY, please reset the synthesizer: synthesizer.reset()");
        this.#setState(Synthesizer.STATE.SYNTHESIZING);
        this._startupTime = _.defaultTo(this._startupTime, performance.now());
        (async () => {
            await fs.ensureDir(path.dirname(this.outputPath));
            await fs.ensureDir(this.tmpDirPath);
            // 等待启动前已添加的音频加载完成
            await this.#waitForAudiosLoaded();
            await new Promise((resolve, reject) => {
                this._createVideoEncoder()
                    .once("start", cmd => util.ffmpegLog(cmd))
                    .on("progress", e => {
                        if (!this._targetFrameCount)
                            return this._emitProgress(0, 0, 0);
                        const progres = e.frames / this._targetFrameCount;
                        this._emitProgress(progres * (this.audioSynthesis ? 98 : 100), e.frames, this._targetFrameCount);
                    })
                    .once("error", reject)
                    .once("end", resolve)
                    .run();
            });
            if (!this._isVideoChunk()) {
                if (this.audioSynthesis) {
                    // 等待渲染期间新添加的音频加载完成
                    await this.#waitForAudiosLoaded();
                    await new Promise((resolve, reject) => {
                        this._createAudioEncoder()
                            .once("start", cmd => util.ffmpegLog(cmd))
                            .on("progress", e => this._emitProgress(98 + ((e.percent || 0) * 0.02), this._targetFrameCount, this._targetFrameCount))
                            .once("error", reject)
                            .once("end", resolve)
                            .run();
                    });
                    await fs.remove(this._swapFilePath);
                }
                else
                    await fs.move(this._swapFilePath, this.outputPath, { overwrite: true });
            }
            this.coverCapture && await this.#captureCover();
            this.#setState(Synthesizer.STATE.COMPLETED);
            this._emitCompleted();
        })()
            .catch(err => this._emitError(err));
    }

    /**
     * 终止合成
     */
    abort() {
        this.#drain();
        this.#closeEncoder(true);
    }

    /**
     * 输入帧
     * 
     * @param {Buffer} buffer - 帧缓冲区
     */
    input(buffer) {
        if (!this.#pipeStream)
            this.#pipeStream = new PassThrough();
        this.#frameBuffers[this.#frameBufferIndex] = buffer;
        this._frameCount++;
        if (++this.#frameBufferIndex < this.parallelWriteFrames)
            return;
        this.#pipeStream.write(Buffer.concat(this.#frameBuffers));
        this.#frameBufferIndex = 0;
    }

    /**
     * 结束帧输入
     */
    endInput() {
        this.#drain();
        this.#closeEncoder();
    }

    /**
     * 等待音频加载完成
     */
    async #waitForAudiosLoaded() {
        await Promise.all(this.audios.map(audio => audio.load()));
    }

    /**
     * 将缓冲区剩余帧写入管道
     */
    #drain() {
        if (!this.#pipeStream)
            return;
        if (this.#frameBufferIndex > 0)
            this.#pipeStream.write(Buffer.concat(this.#frameBuffers));
        this.#frameBufferIndex = 0;
        if (!this.#pipeStream.closed)
            this.#pipeStream.end();
        this.#pipeStream = null;
    }

    /**
     * 发送进度事件
     * 
     * @protected
     * @param {number} value - 进度值
     */
    _emitProgress(value) {
        if (value > 100)
            value = 100;
        this.progress = Math.floor(value * 1000) / 1000;
        if (this._cliProgress) {
            if (!this._cliProgress.started) {
                if (this._cliProgress instanceof cliProgress.MultiBar)
                    this._cliProgress = this._cliProgress.create(this._targetFrameCount, 0);
                else
                    this._cliProgress.start(this._targetFrameCount, 0);
                this._cliProgress.started = true;
            }
            this._cliProgress.update(this._frameCount, { filename: this.name });
        }
        this.emit("progress", this.progress, this._frameCount, this._targetFrameCount);
    }

    /**
     * 发送已完成事件
     * 
     * @protected
     */
    _emitCompleted() {
        this._emitProgress(100);
        if (this._cliProgress) {
            this._cliProgress.stop();
            this._cliProgress = null;
        }
        const takes = performance.now() - this._startupTime;
        this._startupTime = null;
        const result = {
            takes,
            duration: this.duration,
            rtf: this.duration / takes
        };
        this.emit("completed", result);
    }

    /**
     * 发送错误事件
     * 
     * @protected
     * @param {Error} err - 错误对象
     */
    _emitError(err) {
        if (_.isString(err))
            err = new Error(err);
        const message = err.message;
        if (message.indexOf("Error while opening encoder for output stream") != -1 || message.indexOf("ffmpeg exited with code 3221225477") != -1)
            err = new Error(`Video codec ${this.videoEncoder} may not be supported, please check if your hardware supports it: https://github.com/Vinlic/WebVideoCreator/blob/master/docs/video-encoder.md. Some hardware encoders may have limitations in parallel encoding (such as NVENC https://github.com/keylase/nvidia-patch)`);
        if (this._cliProgress) {
            this._cliProgress.stop();
            this._cliProgress = null;
        }
        if (this.eventNames().includes("error"))
            this.emit("error", err);
        else
            logger.error(err);
    }

    /**
     * 添加音频
     * 
     * @param {Audio} audio - 音频对象
     */
    addAudio(audio) {
        if (!(audio instanceof Audio))
            audio = new Audio(audio);
        // 开始加载音频
        audio.load()
            .catch(err => this._emitError(err));
        this.audios.push(audio);
        return audio;
    }

    /**
     * 添加多个音频
     * 
     * @param {Audio[]} audios - 音频对象列表
     */
    addAudios(audios) {
        audios.forEach(audio => this.addAudio(audio));
    }

    /**
     * 更新音频
     * 
     * @param {number} audioId - 音频ID
     * @param {Audio} options - 音频选项
     */
    updateAudio(audioId, options) {
        assert(_.isObject(options), "options must be Object");
        const audio = this.audios.find(audio => audio.id === audioId);
        audio && Object.assign(audio, options);
        return audio;
    }

    /**
     * 创建视频编码器
     * 
     * @protected
     * @returns {FfmpegCommand} - 编码器
     */
    _createVideoEncoder() {
        const { outputPath, width, height, fps, format, videoEncoder, videoBitrate,
            videoQuality, pixelFormat, attachCoverPath, _swapFilePath } = this;
        const vencoder = ffmpeg();
        // 设置视频码率将忽略质量设置
        if (videoBitrate)
            vencoder.videoBitrate(videoBitrate);
        else {
            // 计算总像素量
            const pixels = width * height;
            // 根据像素总量设置视频码率
            vencoder.videoBitrate(`${(2560 / 921600 * pixels) * (videoQuality / 100)}k`);
        }
        const encodingType = this.getVideoEncodingType();
        if (encodingType == "H264" || encodingType == "H265") {
            // 使用主要配置
            vencoder.outputOption("-profile:v main");
            // 使用中等预设
            vencoder.outputOption("-preset medium");
        }
        vencoder.addInput(this.#pipeStream);
        if (attachCoverPath) {
            // 附加封面
            vencoder.addInput(attachCoverPath);
            vencoder.complexFilter(`[1:v]scale=${width}:${height}[cover];[0:v][cover]overlay=repeatlast=0,scale=w=${width}:h=${height},format=${pixelFormat}`);
        }
        else {
            vencoder
                // 设置视频宽高
                .setSize(`${width}x${height}`)
                // 设置像素格式
                .outputOption("-pix_fmt", pixelFormat)
        }
        // 保持透明通道
        this.hasAlphaChannel && vencoder.outputOption("-auto-alt-ref 0");
        vencoder
            // 使用图像管道
            .inputFormat("image2pipe")
            // 指定输入帧率
            .inputFPS(fps)
            // 去除冗余信息
            .inputOption("-hide_banner")
            // 指定视频编码器
            .videoCodec(videoEncoder)
            // 将MOOV头移到最前面
            .outputOption("-movflags +faststart")
            // 指定输出格式
            .toFormat(format)
            // 指定输出路径
            .output(this._isVideoChunk() ? outputPath : _swapFilePath);
        this.#encoder = vencoder;
        return vencoder;
    }

    /**
     * 创建音频编码器
     * 
     * @protected
     * @returns {FfmpegCommand} - 编码器
     */
    _createAudioEncoder() {
        const { outputPath, _swapFilePath, format, audioEncoder,
            audioBitrate, volume: videoVolume, audios } = this;
        const aencoder = ffmpeg();
        // 指定音频码率
        audioBitrate && aencoder.audioBitrate(audioBitrate);
        const outputDuration = this.getOutputDuration();
        aencoder
            .addInput(_swapFilePath)
            .videoCodec("copy")
            .setDuration(outputDuration / 1000)
            .audioCodec(audioEncoder)
            .outputOption("-movflags +faststart")
            .toFormat(format)
            .addOutput(outputPath);
        // 生成音频时间轴的复合过滤器参数
        let outputs = "";
        const complexFilter = audios.reduce((result, audio, index) => {
            const { path, url, loop, startTime, endTime = outputDuration, duration, volume, seekStart, seekEnd, fadeInDuration, fadeOutDuration } = audio;
            if (seekEnd && seekEnd - seekStart > duration)
                return result;
            // 添加音频输入
            aencoder.addInput(path || url);
            // 设置裁剪开始时间点
            seekStart && aencoder.addInputOption("-ss", util.millisecondsToHmss(seekStart));  //截取开始时间点
            // 设置裁剪结束时间点
            seekEnd && aencoder.addInputOption("-to", util.millisecondsToHmss(seekEnd));  //截取结束时间点
            // 时长裁剪过滤器
            const cutFilter = `atrim=start=0:end=${(endTime - startTime) / 1000}`;
            // 循环过滤器
            const loopFilter = loop ? ",aloop=loop=-1:size=2e+09" : "";
            // 延迟过滤器
            const delayFilter = `,adelay=${startTime}|${startTime}`;
            // 音量过滤器
            const volumeFilter = `,volume=${Math.floor((volume * videoVolume) * 0.01) / 100}`;
            // 音频淡入过滤器
            const fadeInFilter = fadeInDuration ? `,afade=t=in:st=${startTime / 1000}:d=${fadeInDuration / 1000}` : "";
            // 音频淡出过滤器
            const fadeOutFilter = fadeOutDuration ? `,afade=t=out:st=${((loop ? endTime : (Math.min(endTime, duration) || duration)) - fadeOutDuration) / 1000}:d=${fadeOutDuration / 1000}` : "";
            // 输出标志
            const output = `a${index}`;
            outputs += `[${output}]`;
            return result + `[${1 + index}]${cutFilter}${loopFilter}${delayFilter}${volumeFilter}${fadeInFilter}${fadeOutFilter}[${output}];`;
        }, "");
        // 应用符合过滤器
        complexFilter && aencoder.complexFilter(`${complexFilter}${outputs}amix=inputs=${audios.length}:normalize=0`);
        this.#encoder = aencoder;
        return aencoder;
    }

    /**
     * 捕获封面
     */
    async #captureCover() {
        const { outputPath, coverCaptureTime, coverCaptureFormat } = this;
        assert(["jpg", "png", "bmp"].includes(coverCaptureFormat), "coverCaptureFormat must be jpg or png or bmp");
        let captureTime = 0;
        if (_.isFinite(coverCaptureTime))
            captureTime = Math.min(coverCaptureTime, this.getOutputDuration());
        else
            captureTime = this.getOutputDuration() * 0.2;
        const coverPath = path.join(path.dirname(outputPath), `${path.basename(outputPath)}.${coverCaptureFormat}`);
        await util.captureScreenshot(outputPath, coverPath, captureTime);
    }

    /**
     * 关闭编码器
     * 
     * @param {boolean} abort - 是否强制终止
     */
    #closeEncoder(abort = false) {
        if (!this.#encoder)
            return;
        // 如果为强制终止则移除结束事件
        abort && this.#encoder.removeAllListeners("end");
        // 强制退出
        if (this.#encoder.ffmpegProc)
            this.#encoder.ffmpegProc.stdin.write("q");
        this.#encoder = null;
    }

    /**
     * 获取已合成视频时长
     * 
     * @returns {number} - 已合成视频时长
     */
    getOutputDuration() {
        if (!this.fps || !this._frameCount)
            return this.duration || 0;
        return Math.floor(this._frameCount / this.fps) * 1000;
    }

    /**
     * 移除输出文件
     */
    async removeOutputFile() {
        const { outputPath, coverCaptureFormat } = this;
        const coverPath = path.join(path.dirname(outputPath), `${path.basename(outputPath)}.${coverCaptureFormat}`);
        await fs.remove(outputPath);
        await fs.remove(coverPath);
    }

    /**
     * 重置合成器
     */
    reset() {
        this.#frameBufferIndex = 0;
        this.#frameBuffers = new Array(this.parallelWriteFrames);
        this._frameCount = 0;
        this._startupTime = null;
        this.#closeEncoder(true);
        if (this.#pipeStream && !this.#pipeStream.closed)
            this.#pipeStream.end();
        this.#pipeStream = null;
        this.#setState(Synthesizer.STATE.READY);
    }

    /**
     * 获取当前视频编码器编码类型
     * 
     * @returns {string} - 编码类型
     */
    getVideoEncodingType() {
        const videoEncoder = this.videoEncoder;
        for (let key in VIDEO_ENCODER_MAP) {
            if (VIDEO_ENCODER_MAP[key].includes(videoEncoder))
                return key;
        }
        return null;
    }

    /**
     * 获取当前音频编码器编码类型
     * 
     * @returns {string} - 编码类型
     */
    getAudioEncodingType() {
        const audioEncoder = this.audioEncoder;
        for (let key in AUDIO_ENCODER_MAP) {
            if (AUDIO_ENCODER_MAP[key].includes(audioEncoder))
                return key;
        }
        return null;
    }

    /**
     * 是否已就绪
     * 
     * @returns {boolean} - 是否已就绪
     */
    isReady() {
        return this.state == Synthesizer.STATE.READY;
    }

    /**
     * 是否合成中
     * 
     * @returns {boolean} - 是否合成中
     */
    isSynthesizing() {
        return this.state == Synthesizer.STATE.SYNTHESIZING;
    }

    /**
     * 是否已完成
     * 
     * @returns {boolean} - 是否已完成
     */
    isCompleted() {
        return this.state == Synthesizer.STATE.COMPLETED;
    }

    /**
     * 移除所有监听器
     */
    removeListeners() {
        this.removeAllListeners("completed");
        this.removeAllListeners("progress");
        this.removeAllListeners("error");
    }

    /**
     * 挂载CliProgress
     * 
     * @param {cliProgress.SingleBar} instance - cli进度条
     */
    attachCliProgress(instance) {
        this.showProgress = true;
        this._cliProgress = instance;
    }

    /**
     * 设置合成器状态
     * 
     * @param {Synthesizer.STATE} state - 合成器状态
     */
    #setState(state) {
        assert(_.isSymbol(state), "state must be Symbol");
        this.state = state;
    }

    /**
     * 设置encoder
     */
    set encoder(value) {
        this.#encoder = value;
    }

    /**
     * 获取encoder
     */
    get encoder() {
        return this.#encoder;
    }

    /**
     * 获取管道流
     */
    get pipeStream() {
        return this.#pipeStream;
    }

    /**
     * 获取已处理帧数
     * 
     * @returns {number} - 已处理帧数
     */
    get frameCount() {
        return this._frameCount;
    }

    /**
     * 获取目标总帧数
     * 
     * @returns {number} - 目标总帧数
     */
    get targetFrameCount() {
        return this._targetFrameCount;
    }

    /**
     * 获取是否合成音频
     * 
     * @returns {boolean} - 是否合成音频
     */
    get audioSynthesis() {
        return this.audios.length > 0;
    }

    /**
     * 获取是否具有透明通道
     */
    get hasAlphaChannel() {
        return this.format == "webm" && this.backgroundOpacity < 1;
    }

    /**
     * 判断是否VideoChunk
     * 
     * @protected
     * @returns {boolean} - 是否为VideoChunk
     */
    _isVideoChunk() {
        return false;
    }

}