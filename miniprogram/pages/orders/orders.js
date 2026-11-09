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
          statusText: statusText(order.status),
          canRefund: order.paymentStatus === "paid"
            && order.status === "pending"
            && Number(order.totalAmount || 0) > Number(order.refundAmount || 0)
        }));
      this.setData({ orders });
    } catch (error) {
      wx.showToast({ title: "订单加载失败", icon: "none" });
      console.error(error);
    } finally {
      wx.hideLoading();
    }
  },

  requestRefund(event) {
    const orderId = event.currentTarget.dataset.id;
    const order = this.data.orders.find((item) => item.id === orderId);
    if (!order || !order.canRefund) {
      wx.showToast({ title: "订单接单后不可退款", icon: "none" });
      return;
    }
    wx.showModal({
      title: "确认退款",
      content: `确认取消订单 ${order.orderNo} 并原路退回 ¥${order.totalText} 吗？`,
      confirmText: "确认退款",
      confirmColor: "#c53b35",
      success: async (result) => {
        if (!result.confirm) return;
        wx.showLoading({ title: "退款中" });
        try {
          const response = await wx.cloud.callFunction({
            name: app.globalData.membershipFunction,
            data: {
              action: "refundMiniProgramOrder",
              payload: { orderId }
            }
          });
          if (!response.result?.ok) throw new Error(response.result?.message || "退款失败");
          wx.showToast({ title: "退款申请成功", icon: "success" });
          await this.loadOrders();
        } catch (error) {
          wx.showToast({ title: error.message || "退款失败", icon: "none" });
        } finally {
          wx.hideLoading();
        }
      }
    });
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
