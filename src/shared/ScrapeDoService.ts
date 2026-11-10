import axios, { type AxiosRequestConfig } from "axios";
const REQUEST_TIMEOUT_MS = 60_000;
const SCRAPE_DO_URL = "https://api.scrape.do/";

interface CallScrapeDoPayload {
  url: string; // target URL to scrape
  params?: Record<string, string>; // extra scrape.do options (render, geoCode, ...)
  headers?: Record<string, string>; // forwarded to target when extraHeaders=true
  body?: unknown; // POST only
}

export class ScrapeDoService {
  private get token() {
    const t = process.env.SCRAPE_DO_TOKEN;
    if (!t) throw new Error("SCRAPE_DO_TOKEN is not set");
    return t;
  }

  private buildConfig({
    url,
    params,
    headers,
  }: CallScrapeDoPayload): AxiosRequestConfig {
    return {
      params: {
        token: this.token,
        url, // axios URL-encodes this
        extraHeaders: "true",
        ...params,
      },
      headers,
      timeout: REQUEST_TIMEOUT_MS,
    };
  }

  async callGet<T>(payload: CallScrapeDoPayload): Promise<ServiceResult<T>> {
    try {
      const { data } = await axios.get<T>(
        SCRAPE_DO_URL,
        this.buildConfig(payload),
      );
      return { success: true, data };
    } catch (error: any) {
      return { success: false, message: this.errorMessage(error) };
    }
  }

  async callPost<T>(payload: CallScrapeDoPayload): Promise<ServiceResult<T>> {
    try {
      const { data } = await axios.post<T>(
        SCRAPE_DO_URL,
        payload.body,
        this.buildConfig(payload),
      );
      return { success: true, data };
    } catch (error: any) {
      return { success: false, message: this.errorMessage(error) };
    }
  }

  private errorMessage(error: any): string {
    const body = error?.response?.data;
    return body
      ? `${error.message}: ${typeof body === "string" ? body : JSON.stringify(body)}`
      : error.message;
  }
}
