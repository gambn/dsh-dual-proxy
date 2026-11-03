// DSH（cordis）插件入口。真正的适配层在 adapters/dsh.js；
// 这里保留原来的路径，package.json 的 main 和既有调用方不用改。
export * from './adapters/dsh.js';
