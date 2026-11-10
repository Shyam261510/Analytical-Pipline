import Redis from "ioredis";

class RedisProvider {
  private static instance: RedisProvider | null = null;
  private redisClient: Redis;
  constructor() {
    this.redisClient = new Redis(process.env.REDIS_STACK_PORT!);
  }

  static getInstance() {
    if (!RedisProvider.instance) {
      RedisProvider.instance = new RedisProvider();
    }
    return RedisProvider.instance;
  }

  public getClient(): Redis {
    return this.redisClient;
  }
  public async setHashValue(
    key: string,
    value: Record<string, unknown>,
    expire = 30,
  ) {
    const fields = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, JSON.stringify(v)] as const);
    if (!fields.length) return;

    await this.redisClient
      .multi()
      .hset(key, Object.fromEntries(fields))
      .expire(key, expire)
      .exec();
  }

  public async setList<T>(
    key: string,
    values: T[],
    expire = 30,
  ): Promise<void> {
    // 1. Ensure the array is not empty to avoid a Redis error
    if (!values || values.length === 0) return;

    // 2. Convert elements to JSON strings so Redis can store them
    const stringifiedValues = values.map((val) =>
      typeof val === "string" ? val : JSON.stringify(val),
    );

    // 3. Push the items into the list using the spread operator (...)
    await this.redisClient.lpush(key, ...stringifiedValues);

    // 4. Set the expiration using a separate command (in seconds)
    await this.redisClient.expire(key, expire);
  }

  public async pushToList(key: string, value: any, expire = 30) {
    // 1. Ensure the array is not empty to avoid a Redis error
    if (!value) return;
    // 2. Convert elements to JSON strings so Redis can store them
    await this.redisClient.lpush(key, JSON.stringify(value));
    // 3. Set the expiration using a separate command (in seconds)
    await this.redisClient.expire(key, expire);
  }

  public async getHashValue<T>(
    key: string,
    fields: string[],
  ): Promise<(T | null)[]> {
    // 1. Fetch the raw string array from Redis
    const rawValues = await this.redisClient.hmget(key, ...fields);

    // 2. Map over the array and parse each non-null string
    return rawValues.map((value) => {
      if (value === null) return null;

      try {
        // Parse the JSON string into type T
        return JSON.parse(value) as T;
      } catch {
        // Fallback: If it's a plain string that isn't JSON, return it as-is
        return value as unknown as T;
      }
    });
  }
  public async getMultipleLists(keys: string[]) {
    const pipeline = this.redisClient.pipeline();

    // 1. Queue up the LRANGE commands
    keys.forEach((key) => {
      pipeline.lrange(key, 0, -1);
    });

    // 2. Execute the pipeline
    const responses = await pipeline.exec();
    if (!responses) {
      return null;
    }

    // FIX 2: Explicitly type your accumulator object to accept string keys
    // mapping to string arrays: Record<string, string[]>
    const dataMap: Record<string, string[]> = {};

    keys.forEach((key, index) => {
      const row = responses[index];

      // FIX 1: Safely guard against undefined items before destructuring
      if (!row) {
        return;
      }

      const [err, listData] = row;

      if (err) {
        console.error(`Error fetching key ${key}:`, err);
      } else {
        // TypeScript now knows listData is a string[] (or unknown that we cast)
        dataMap[key] = listData as string[];
      }
    });

    return dataMap;
  }

  public async updateListValue<T>(
    key: string,
    index: number,
    newObjectValue: T,
  ): Promise<void> {
    // 1. Convert your JavaScript object into a string
    const stringifiedValue = JSON.stringify(newObjectValue);

    // 2. Update the element at the specified index
    // (Note: index is 0-indexed; use negative numbers to count from the end)
    await this.redisClient.lset(key, index, stringifiedValue);
  }
}

export const redis = RedisProvider.getInstance();
