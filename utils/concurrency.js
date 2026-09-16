/**
 * Runs `worker(item)` for every item in `items`, at most `limit` at a time.
 * No dependency needed for something this small — just a shared cursor and
 * `limit` workers pulling from it until the list is empty.
 */
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, runWorker);
  await Promise.all(workers);

  return results;
}
