const aiwaLocalHostnames = ["127.0.0.1", "localhost", ""];
const aiwaParams = new URLSearchParams(window.location.search);
const aiwaIsLocalTest = aiwaLocalHostnames.includes(window.location.hostname);
const aiwaIsExplicitLocal = aiwaParams.get("local") === "1";

window.AIWA_CLOUDBASE_CONFIG = {
  enabled: aiwaParams.get("cloud") === "1" || (!aiwaIsLocalTest && aiwaParams.get("local") !== "1"),
  localApi: aiwaParams.get("cloud") !== "1" && (aiwaParams.get("localApi") === "1" || aiwaIsExplicitLocal || aiwaIsLocalTest),
  localApiUrl: "/api/local-data",
  envId: "elva-pizza-test-d1far2ax4213b224",
  envName: "elva-pizza-test",
  accountId: "100047037371",
  region: "ap-shanghai",
  collections: {
    stores: "stores",
    staff: "staff",
    members: "members",
    transactions: "transactions",
    categories: "categories",
    products: "products",
    orders: "orders",
    refunds: "refunds",
    bonusRules: "bonusrules",
  },
  functions: {
    membershipApi: "membershipApi",
  },
};
