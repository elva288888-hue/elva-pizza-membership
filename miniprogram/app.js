App({
  globalData: {
    envId: "elva-pizza-test-d1far2ax4213b224",
    membershipFunction: "membershipApi",
    payFunction: "partnerPay",
    payCallType: "cloudFunction",
    payOrderPath: "",
    storeId: "store_aiwa_pizza_main",
    customer: null
  },

  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        env: this.globalData.envId,
        traceUser: true
      });
    }
  }
});
