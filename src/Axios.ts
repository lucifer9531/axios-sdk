import type { AxiosRequestConfig, AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import type { RequestOptions, Result, UploadFileParams } from '/#/axios';
import type { CreateAxiosOptions } from './axiosTransform';
import axios from 'axios';
import qs from 'qs';
import { AxiosCanceler } from './axiosCancel';
import { isFunction } from './utils/is';
import { cloneDeep } from 'lodash-es';
import { ContentTypeEnum, RequestEnum } from './enums/httpEnum';

export * from './axiosTransform';

export class VAxios {
  private static axiosInstance: AxiosInstance;
  private readonly options: CreateAxiosOptions;

  constructor(options: CreateAxiosOptions) {
    this.options = options;
    VAxios.axiosInstance = axios.create(options);
    this.setupInterceptors();
  }

  /**
   * @description create axios instance
   * @param config
   * @private
   */
  private createAxios(config: CreateAxiosOptions): AxiosInstance {
    if (!VAxios.axiosInstance) {
      VAxios.axiosInstance = axios.create(config);
    }
    return VAxios.axiosInstance;
  }

  private getTransform() {
    const { transform } = this.options;
    return transform;
  }

  public getAxios(): AxiosInstance {
    return VAxios.axiosInstance;
  }

  /**
   * config axios
   * @param config
   */
  public configAxios(config: CreateAxiosOptions) {
    if (!VAxios.axiosInstance) {
      return;
    }
    this.createAxios(config);
  }

  /**
   * Set general header
   * @param headers
   */
  public setHeader(headers: any): void {
    if (!VAxios.axiosInstance) return;
    Object.assign({}, VAxios.axiosInstance?.defaults?.headers, headers);
  }

  /**
   * set request interceptors
   * @private
   */
  private setupInterceptors() {
    const transform = this.getTransform();
    if (!transform) {
      return;
    }
    const {
      requestInterceptors,
      requestInterceptorsCatch,
      responseInterceptors,
      responseInterceptorsCatch,
    } = transform;

    const axiosCanceler = new AxiosCanceler();

    // Request interceptor configuration processing
    VAxios.axiosInstance.interceptors.request.use((config: AxiosRequestConfig) => {
      // If cancel repeat request is turned on, then cancel repeat request is prohibited

      const ignoreCancel = this.options.requestOptions?.ignoreCancelToken;

      !ignoreCancel && axiosCanceler.addPending(config);
      if (requestInterceptors && isFunction(requestInterceptors)) {
        config = requestInterceptors(config, this.options);
      }
      return config;
    }, undefined);

    // Request interceptor error capture
    requestInterceptorsCatch &&
    isFunction(requestInterceptorsCatch) &&
    VAxios.axiosInstance.interceptors.request.use(undefined, requestInterceptorsCatch);

    // Response result interceptor processing
    VAxios.axiosInstance.interceptors.response.use((res: AxiosResponse<any>) => {
      res && axiosCanceler.removePending(res.config);
      if (responseInterceptors && isFunction(responseInterceptors)) {
        res = responseInterceptors(res);
      }
      return res;
    }, undefined);

    // Response result interceptor error capture
    responseInterceptorsCatch &&
    isFunction(responseInterceptorsCatch) &&
    VAxios.axiosInstance.interceptors.response.use(undefined, responseInterceptorsCatch);
  }

  /**
   * upload file
   * @param config
   * @param params
   */
  public uploadFile<T = any>(config: AxiosRequestConfig, params: UploadFileParams) {
    const formData = new window.FormData();
    const customFilename = params.name || 'file';

    if (params.filename) {
      formData.append(customFilename, params.file, params.filename);
    } else {
      formData.append(customFilename, params.file);
    }

    if (params.data) {
      Object.keys(params.data).forEach((key) => {
        const value = params.data![key];
        if (Array.isArray(value)) {
          value.forEach((item) => {
            formData.append(`${key}[]`, item);
          });
          return;
        }

        formData.append(key, params.data![key]);
      });
    }

    return VAxios.axiosInstance.request<T>({
      ...config,
      method: 'POST',
      data: formData,
      headers: {
        'Content-type': ContentTypeEnum.FORM_DATA,
        ignoreCancelToken: true as unknown as string,
      },
    });
  }

  /**
   * support formatData
   * @param config
   */
  public supportFormData(config: AxiosRequestConfig) {
    const headers = config.headers || this.options.headers;
    const contentType = headers?.['Content-Type'] || headers?.['content-type'];
    if (contentType !== ContentTypeEnum.FORM_URLENCODED || !Reflect.has(config, 'data') || config.method?.toUpperCase() === RequestEnum.GET) {
      return config;
    }
    return  {
      ...config,
      data: qs.stringify(config.data, { arrayFormat: 'brackets' })
    };
  }

  get<T = any>(config: AxiosRequestConfig, options?: RequestOptions): Promise<T> {
    return this.request({ ...config, method: 'GET' }, options);
  }

  post<T = any>(config: AxiosRequestConfig, options?: RequestOptions): Promise<T> {
    return this.request({ ...config, method: 'POST' }, options);
  }

  put<T = any>(config: AxiosRequestConfig, options: RequestOptions): Promise<T> {
    return this.request({ ...config, method: 'PUT' }, options);
  }

  delete<T = any>(config: AxiosRequestConfig, options: RequestOptions): Promise<T> {
    return this.request({ ...config, method: 'DELETE' }, options);
  }

  /**
   * Request encapsulation
   * @param config
   * @param options
   */
  request<T = any>(config: AxiosRequestConfig, options?: RequestOptions): Promise<T> {
    let conf: CreateAxiosOptions = cloneDeep(config);
    const transform = this.getTransform();

    const { requestOptions } = this.options;

    const opt: RequestOptions = Object.assign({}, requestOptions, options);

    const { beforeRequestHook, requestCatchHook, transformRequestHook } = transform || {};
    if (beforeRequestHook && isFunction(beforeRequestHook)) {
      conf = beforeRequestHook(config, opt);
    }
    conf.requestOptions = opt;

    conf = this.supportFormData(conf);

    return new Promise((resolve, reject) => {
      VAxios.axiosInstance.request<any, AxiosResponse<Result>>(conf).then((res: AxiosResponse<Result>) => {
        if (transformRequestHook && isFunction(transformRequestHook)) {
          try {
            const ret = transformRequestHook(res, opt);
            resolve(ret);
          } catch (err) {
            reject(err || new Error('request error!'));
          }
          return;
        }
      }).catch((e: Error | AxiosError) => {
        if (requestCatchHook && isFunction(requestCatchHook)) {
          reject(requestCatchHook(e, opt));
          return;
        }
        if (axios.isAxiosError(e)) {
          // TODO rewrite error message from axios in here
        }
        reject(e);
      });
    });
  }
}
