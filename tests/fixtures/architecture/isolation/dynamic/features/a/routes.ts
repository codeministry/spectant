// Fixture for the isolation rule (spec 061, ISC-431): feature a loads a page of feature b lazily.
export const routes = {
  home: () => import("../b/page").then((m) => m.page),
};
