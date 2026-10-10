export { httpClient, createHttpClient } from "./HttpClient";
export type {
  HttpRequestConfig,
  HttpResponse,
  HttpError,
  RequestInterceptor,
  ResponseInterceptor,
  ErrorInterceptor,
} from "./HttpClient";
export {
  setupApiInterceptors,
  setupAuthInterceptor,
  setupLoggingInterceptor,
  setupErrorTransformationInterceptor,
  setupSecurityInterceptor,
} from "./interceptors";
