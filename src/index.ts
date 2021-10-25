import type { AxiosTransform, CreateAxiosOptions } from './axiosTransform';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { RequestOptions, Result } from "/#/axios";
import { ContentTypeEnum, RequestEnum, ResultEnum } from "./enums/httpEnum";
import { isString } from "./utils/is";
import { formatRequestDate, joinTimestamp } from "./helper";
import { deepMerge, setObjToUrlParams } from "./utils";
import { VAxios } from "./Axios";

const transform: AxiosTransform = {
  transformRequestHook: (res: AxiosResponse<Result>, options: RequestOptions) => {
    const { isTransformResponse, isReturnNativeResponse } = options;
    // 是否返回原生的响应头 比如：需要获取响应头时使用该属性
    if (isReturnNativeResponse) {
      return res;
    }
    // 不进行任何处理 直接返回
    // 用于页面代码可能需要直接获取code，data, message 这些信息的开启
    if (!isTransformResponse) {
      return res?.data;
    }
    // 错误时候返回
    const { data } = res;
    if (!data) {
      throw new Error('api request failed'!);
    }
    // 这里 code result message 为 后台统一的字段
    const { code, result, message } = data;

    const hasSuccess = data && Reflect.has(data, 'code') && code === ResultEnum.SUCCESS;
    if (hasSuccess) {
      return result;
    }

    // 对不同的code进行处理
    // 如果不希望中断当前请求， 请return 数据 否则直接抛出异常即可
    let timeoutMsg = '';
    switch (code) {
      case ResultEnum.TIMEOUT:
        timeoutMsg = '响应时间超时';
        // TODO 退出操作
        break;
      default:
        if (message) {
          timeoutMsg = message;
        }
        break;
    }
    // errorMessageMode='modal' 的时候会显示modal的错误弹框 而不是消息提示 用于一些比较重要的错误
    // errorMessageMode='none' 一般调用的时候明确表示不希望自动弹出错误提示
    if (options.errorMessageMode === 'modal') {
      // ...TODO modal 消息提示 重要消息
    } else if (options.errorMessageMode === 'message') {
      // ...TODO message 消息提示
    }

    throw new Error(timeoutMsg || 'api request failed!');
  },

  /**
   * 请求之前处理config
   * @param config
   * @param options
   */
  beforeRequestHook(config: AxiosRequestConfig, options: RequestOptions) {
    const { apiUrl, joinPrefix, joinParamsToUrl, formatDate, joinTime = true, urlPrefix } = options;
    if (joinPrefix) {
      config.url = `${urlPrefix}${config.url}`;
    }
    if (apiUrl && isString(apiUrl)) {
      config.url = `${apiUrl}${config.url}`;
    }
    const params = config.params || {};
    const data = config.data || false;
    formatDate && data && !isString(data) && formatRequestDate(data);
    if (config.method?.toUpperCase() === RequestEnum.GET) {
      if (!isString(params)) {
        // 给 get 请求加上时间戳参数，避免从缓存中拿数据。
        config.params = Object.assign({}, params || {}, joinTimestamp(joinTime, false));
      } else {
        // 兼容restful 风格
        config.url = config.url + params + `${joinTimestamp(joinTime, true)}`;
        config.params = undefined;
      }
    } else {
      if (!isString(params)) {
        formatDate && formatRequestDate(params);
        if (Reflect.has(config, 'data') && config.data && Object.keys(config.data).length > 0) {
          config.data = data;
          config.params = params;
        } else {
          // 非GET请求如果没有提供data，则将params视为data
          config.data = params;
          config.params = undefined;
        }
        if (joinParamsToUrl) {
          config.url = setObjToUrlParams(config.url as string, Object.assign({}, config.params, config.data));
        }
      } else {
        // 兼容restful风格接口
        config.url = config.url + params;
        config.params = undefined;
      }
    }
    return config;
  },

  /**
   * request interceptor handler
   * @param token
   * @param config
   * @param options
   */
  requestInterceptors: (config: AxiosRequestConfig, options: CreateAxiosOptions, token: string) => {
    // 请求之前处理config
    if (token && (config as Recordable)?.requestOptions?.withToken !== false) {
      (config as Recordable).headers.Authorization = options.authenticationScheme ? `${options.authenticationScheme} ${token}` : token;
    }
    return config;
  },

  responseInterceptors: (res: AxiosResponse<any>) => {
    return res;
  },

  /**
   * response interceptor error handler
   * @param error
   */
  responseInterceptorsCatch: (error: any) => {
    const { code, message, config } = error || {};
    const errorMessageMode = config?.requestOptions?.errorMessageMode || 'none';
    const err: string = error.toString()?.() ?? '';
    let errMessage: string = '';

    try {
      if (code === 'ECONNABORTED' && message.indexOf('timeout') !== -1) {
        errMessage = '已超时...';
      }
      if (err?.includes('Network Error')) {
        errMessage = '网络错误...'
      }
      if (errMessage) {
        if (errorMessageMode === 'modal') {
          // ...TODO modal 消息提示 重要消息
        } else if (errorMessageMode === 'message') {
          // ...TODO message 消息提示
        }
        return Promise.reject(error)
      }
    } catch (error) {
      throw new Error(error as unknown as string);
    }
    return Promise.reject(error);
  }
}

function createAxios(opt?: Partial<CreateAxiosOptions>) {
  return new VAxios(
    deepMerge({
      authenticationScheme: '',
      timeout: 10 * 1000,
      // 基础接口地址
      // baseURL: '',
      headers: { 'Content-Type': ContentTypeEnum.JSON },
      // 数据处理方式
      transform,
      // 配置项 下面的选项都可以在独立的接口请求中覆盖
      requestOptions: {
        // 默认将prefix 添加到url
        joinPrefix: true,
        // 是否返回原生响应头 比如：需要获取响应头时使用该属性
        isReturnNativeResponse: false,
        // 需要对返回数据进行处理
        isTransformResponse: true,
        // post请求的时候添加参数到url
        joinParamsToUrl: false,
        // 格式化提交参数时间
        formatDate: true,
        // 消息提示类型
        errorMessageMode: 'message',
        //  是否加入时间戳
        joinTime: true,
        // 忽略重复请求
        ignoreCancelToken: true,
        // 是否携带token
        withToken: true,
      }
    }, opt || {})
  )
}

export const defHttp = createAxios();
