export interface UniIdRouter {
  /**
   * 登录页面路径
   *
   * @example "pages/index/index"
   */
  loginPage: string

  /**
   * 需要登录才可以访问的页面列表，可以使用正则语法
   *
   * @example ["pages/detail/.*"]
   */
  needLogin: string[]

  /**
   * 是否是否自动解析云对象及 clientDB 的错误码，如果是客户端 token 不正确或 token 过期则自动跳转配置的登录页面
   *
   * @default true
   */
  resToLogin?: boolean
}
