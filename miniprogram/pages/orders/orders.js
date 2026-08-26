const app = getApp();

Page({
  data: {
    orders: []
  },

  async onShow() {
    await this.loadOrders();
  },

  async loadOrders() {
    wx.showLoading({ title: "加载中" });
    try {
      const customer = app.globalData.customer || {};
      const result = await wx.cloud.callFunction({
        name: app.globalData.membershipFunction,
        data: {
          action: "getMiniProgramOrders",
          payload: {
            storeId: app.globalData.storeId,
            phone: customer.phone || ""
          }
        }
      });
      if (!result.result?.ok) throw new Error(result.result?.message || "订单加载失败");
      const orders = (result.result?.orders || [])
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map((order) => ({
          ...order,
          totalText: Number(order.totalAmount || 0).toFixed(2),
          itemsText: (order.items || []).map((item) => `${item.name}×${item.quantity}`).join("，"),
          statusText: statusText(order.status)
        }));
      this.setData({ orders });
    } catch (error) {
      wx.showToast({ title: "订单加载失败", icon: "none" });
      console.error(error);
    } finally {
      wx.hideLoading();
    }
  }
});

function statusText(status) {
  return {
    pending_payment: "待支付",
    pending: "待接单",
    making: "制作中",
    ready: "待取餐",
    delivering: "配送中",
    completed: "已完成",
    cancelled: "已取消",
    refunded: "已退款",
    partial_refund: "部分退款"
  }[status] || "处理中";
}
