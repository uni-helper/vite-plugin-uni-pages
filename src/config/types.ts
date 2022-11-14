export interface PagesConfig {
  pages: any;
  globalStyle: any;
  easycom: any;
  tabBar: any;
  condition: any;
  subPackages: any;
  preloadRule: any;
  workers: any;
  leftWindow: any;
  topWindow: any;
  rightWindow: any;
  uniIdRouter: any;
}

export interface UserPagesConfig extends Partial<PagesConfig> {}
