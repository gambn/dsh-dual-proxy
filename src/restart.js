/**
 * 串行执行器：任务运行期间再次触发时只记一个 pending，当前任务结束后再跑一次。
 * 用于配置热更新：连续保存两次不会被静默丢弃，最终状态是最后一次读取的配置。
 */
export function createRestarter(task) {
  let running = false;
  let pending = false;

  return async function trigger() {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      do {
        pending = false;
        await task();
      } while (pending);
    } finally {
      running = false;
    }
  };
}
