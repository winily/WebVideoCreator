import { VIDEO_ENCODER, AUDIO_ENCODER } from "./const.js";

export default {

    /**
     * WebVideoCreator调试日志
     * 
     * 开启后将输出一些WVC的调试日志
     * 
     * @type {boolean}
     */
    debug: false,

    /**
     * 浏览器版本
     * 
     * 指定WVC使用的Chrome浏览器版本
     * 
     * @type {string}
     */
    browserVersion: null,

    /**
     * 浏览器无头开关
     * 
     * 建议保持开启，如果关闭请确保开启兼容渲染模式否则无法渲染，仅用于调试画面
     * 
     * @type {boolean}
     */
    browserHeadless: true,

    /**
     * 浏览器帧率限制开关
     * 
     * 默认开启，关闭帧率限制可以提高渲染效率并支持高于60fps的动画，但这会关闭GPU垂直同步可能导致画面撕裂或其它问题
     * 
     * @type {boolean}
     */
    browserFrameRateLimit: true,

    /**
     * 浏览器Debug开关
     * 
     * 开启后将输出浏览器的运行日志
     * 如果你想看页面的日志，请设置视频参数的consoleLog为true，而不是这个
     * 
     * @type {boolean}
     */
    browserDebug: false,
    
    /**
     * FFmpeg Debug开关
     * 
     * 开启后将输出每一条执行的ffmpeg命令
     * 
     * @type {boolean}
     */
    ffmpegDebug: false,

    /**
     * ffmpeg可执行文件路径
     * 
     * 设置后将禁用内部的ffmpeg-static，建议您默认使用内部的FFmpeg以确保功能完整性
     * 
     * @type {string}
     */
    ffmpegExecutablePath: null,

    /**
     * ffprobe可执行文件路径
     * 
     * 设置后将禁用内部的ffprobe-static，建议您默认使用内部的ffprobe以确保功能完整性
     * 
     * @type {string}
     */
    ffprobeExecutablePath: null,

    /**
     * 浏览器GPU加速开关
     * 
     * 建议开启提高渲染性能，如果您没有GPU设备或遭遇了诡异的渲染问题则可以关闭它
     * 
     * @type {boolean}
     */
    browserUseGPU: true,

    /**
     * 浏览器是否使用Angle作为渲染后端
     * 
     * 建议开启增强渲染跨平台兼容性和性能
     */
    browserUseAngle: true,

    /**
     * 是否禁用浏览器使用共享内存
     * 
     * 当/dev/shm分区较小时建议开启此选项
     */
    browserDisableDevShm: false,
    
    /**
     * 浏览器可执行文件路径
     * 
     * 设置后将禁用内部的浏览器，建议您默认使用内部的浏览器以确保功能完整性
     * 
     * @type {string}
     */
    browserExecutablePath: null,

    /**
     * 是否允许不安全的上下文
     * 
     * 默认禁用，开启后能够导航到不安全的URL
     * 但由于不安全上下文限制，将无法在页面中使用动态图像和内嵌视频
     */
    allowUnsafeContext: false,

    /**
     * 兼容渲染模式
     * 
     * 渲染效率降低40%
     * 
     * 不建议启用，启用后将禁用HeadlessExperimental.beginFrame API调用改为普通的Page.screenshot
     * 这会导致渲染性能下降，当你遭遇下面错误的时候可以尝试开启它
     * TargetCloseError: Protocol error (HeadlessExperimental.beginFrame): Target closed
     * 
     * @type {boolean}
     */
    compatibleRenderingMode: false,

    /**
     * 资源池最小浏览器实例数量
     * 
     * @type {number}
     */
    numBrowserMin: 1,

    /**
     * 资源池最大浏览器实例数量
     * 
     * @type {number}
     */
    numBrowserMax: 5,

    /**
     * 浏览器实例最小页面实例数量
     * 
     * @type {number}
     */
    numPageMin: 1,

    /**
     * 浏览器实例最大页面实例数量
     * 
     * @type {number}
     */
    numPageMax: 5,

    /**
     * 访问页面时的用户UA
     */
    userAgent: null,

    /**
     * 捕获帧图质量（0-100）
     * 
     * 仅jpeg有效
     * 
     * @type {number}
     */
    frameQuality: 80,
    
    /**
     * 帧图格式（jpeg/png）
     * 
     * 建议使用jpeg，png捕获较为耗时
     * 
     * @type {string}
     */
    frameFormat: "jpeg",

    /**
     * BeginFrame捕获图像超时时间（毫秒）
     * 
     * @type {number}
     */
    beginFrameTimeout: 5000,

    /**
     * 全局MP4格式的视频编码器
     * 
     * 默认使用libx264软编码器，建议根据您的硬件选用合适的硬编码器加速合成
     * 
     * @type {string}
     */
    mp4Encoder: VIDEO_ENCODER.CPU.H264,

    /**
     * 全局WEBM格式的视频编码器
     * 
     * 默认使用libvpx软编码器，建议根据您的硬件选用合适的硬编码器加速合成
     * 
     * @type {string}
     */
    webmEncoder: VIDEO_ENCODER.CPU.VP8,

    /**
     * 全局音频编码器
     * 
     * 建议采用默认的aac编码器
     * 
     * @type {string}
     */
    audioEncoder: AUDIO_ENCODER.AAC

};