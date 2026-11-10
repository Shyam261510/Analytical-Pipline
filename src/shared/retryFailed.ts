export interface RetryResult<I, O> {
  succeeded: O[];
  failed: I[];
}

// Runs fn on every item in parallel, then recursively retries only the failed items.
export async function retryFailed<I, O>(
  items: I[],
  fn: (item: I) => Promise<O>,
  maxAttempts = 3,
  attempt = 0,
): Promise<RetryResult<I, O>> {
  if (!items.length) return { succeeded: [], failed: [] };

  const settled = await Promise.allSettled(items.map((item) => fn(item)));

  const succeeded: O[] = [];
  const failed: I[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") succeeded.push(r.value);
    else {
      failed.push(items[i]!);
      console.warn(`  ${items[i]}: ${r.reason?.message ?? r.reason}`);
    }
  });

  if (!failed.length) return { succeeded, failed };

  if (attempt + 1 >= maxAttempts) {
    console.error(
      `Gave up after ${maxAttempts} attempts: ${failed.join(", ")}`,
    );
    return { succeeded, failed };
  }

  console.warn(`Retrying (${attempt + 1}): ${failed.join(", ")}`);
  const retried = await retryFailed(failed, fn, maxAttempts, attempt + 1);
  return {
    succeeded: [...succeeded, ...retried.succeeded],
    failed: retried.failed,
  };
}
