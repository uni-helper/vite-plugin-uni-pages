import process from 'node:process'

export enum UniPlatform {
  App = 'app',
  AppAndroid = 'app-android',
  AppIOS = 'app-ios',
  Custom = 'custom',
  H5 = 'h5',
  H5SSR = 'h5:ssr',
  MpAlipay = 'mp-alipay',
  MpBaidu = 'mp-baidu',
  MpJD = 'mp-jd',
  MpKuaiShou = 'mp-kuaishou',
  MpLark = 'mp-lark',
  MpQQ = 'mp-qq',
  MpTouTiao = 'mp-toutiao',
  MpWeixin = 'mp-weixin',
  QuickappWebview = 'quickapp-webview',
  QuickappWebviewHuawei = 'quickapp-webview-huawei',
  QuickappWebviewUnion = 'quickapp-webview-union',
}

export function currentUniPlatform(): UniPlatform
export function currentUniPlatform(platform: string): boolean
export function currentUniPlatform(platform?: string): UniPlatform | boolean {
  return platform === undefined
    ? process.env.UNI_PLATFORM as UniPlatform
    : process.env.UNI_PLATFORM === platform
}
