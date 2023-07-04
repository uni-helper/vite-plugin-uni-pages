declare module "virtual:uni-pages" {
  import { PageMetaDatum } from "./src/types";
  import { SubPackage } from "./src/config/types/index";
  export const pages: PageMetaDatum[];
  export const subPackages: SubPackage[];
}
