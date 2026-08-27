const app = getApp();

Page({
  data: {
    store: null,
    products: [],
    categories: [{ name: "全部" }],
    activeCategory: "全部",
    visibleProducts: [],
    cart: {},
    cartRows: [],
    cartCount: 0,
    cartTotal: 0,
    cartTotalText: "0.00",
    customer: null,
    memberNameInput: "",
    needsMemberName: true,
    authRequired: false,
    authSubmitting: false,
    currentMember: null,
    memberText: "授权后可加入会员并使用余额支付",
    fulfillmentType: "pickup",
    pickupMode: "now",
    pickupDate: "",
    pickupTime: "",
    deliveryAddress: "",
    deliveryRecipientName: "",
    deliveryRecipientPhone: "",
    deliveryDate: "",
    deliveryTime: "",
    deliveryLatitude: null,
    deliveryLongitude: null,
    deliveryDistanceKm: null,
    deliveryAreaConfirmed: false,
    locationStatus: "选择配送后需授权定位，以确认在门店 3 公里内",
    deliverySettings: { fee: 5, freeThreshold: 58, maxDistanceKm: 3, testMode: false },
    deliveryFee: 0,
    deliveryFeeText: "0.00",
    payableTotal: 0,
    payableTotalText: "0.00",
    deliveryFeeHint: "",
    paymentMethod: "wechat_pay",
    orderNote: "",
    addedProductId: "",
    cartExpanded: false,
    rechargeOpen: false,
    rechargeAmount: "100",
    rechargePresets: [50, 100, 200, 500],
    rechargeSubmitting: false,
    orderSuccessOpen: false,
    orderSuccessNo: "",
    orderSuccessMessage: ""
  },

  hasLoaded: false,

  async onLoad() {
    await this.authorizeCustomer();
    await this.loadStoreData();
    this.hasLoaded = true;
  },

  async onShow() {
    if (this.hasLoaded) await this.loadStoreData({ silent: true });
  },

  async onPullDownRefresh() {
    await this.loadStoreData({ silent: true });
    wx.stopPullDownRefresh();
  },

  async authorizeCustomer() {
    const savedName = String(wx.getStorageSync?.("aiwa_member_name") || "").trim();
    const customer = {
      openid: "",
      name: savedName,
      phone: "",
      authorizedAt: new Date().toISOString(),
      source: "mini_program"
    };
    app.globalData.customer = customer;
    this.setData({ customer, memberNameInput: savedName, needsMemberName: !savedName });
  },

  async loadStoreData(options = {}) {
    if (!options.silent) wx.showLoading({ title: "加载中" });
    try {
      const result = await wx.cloud.callFunction({
        name: app.globalData.membershipFunction,
        data: {
          action: "getMiniProgramData",
          payload: {
            storeId: app.globalData.storeId,
            phone: this.data.customer?.phone || ""
          }
        }
      });
      if (!result.result?.ok) throw new Error(result.result?.message || "数据加载失败");
      const products = (result.result.products || [])
        .filter((item) => item.active !== false && !item.deletedAt && !item.soldOut)
        .map((item) => ({ ...item, priceText: money(item.price) }));
      const categories = [
        { name: "全部" },
        ...(result.result.categories || [])
          .filter((item) => products.some((product) => product.category === item.name))
          .map((item) => ({ name: item.name }))
      ];
      const categoryNames = new Set(categories.map((item) => item.name));
      products.forEach((product) => {
        if (product.category && !categoryNames.has(product.category)) {
          categories.push({ name: product.category });
          categoryNames.add(product.category);
        }
      });
      const customer = {
        ...this.data.customer,
        ...(result.result.customer || {}),
        name: this.data.customer?.name || "微信顾客",
        source: "mini_program"
      };
      app.globalData.customer = customer;
      if (result.result.store?.id) app.globalData.storeId = result.result.store.id;
      this.setData({
        store: result.result.store || null,
        customer,
        currentMember: result.result.member || null,
        products,
        categories
        ,deliverySettings: normalizeDeliverySettings(result.result.settings?.delivery)
      });
      this.refreshDerived();
    } catch (error) {
      wx.showToast({ title: "数据加载失败", icon: "none" });
      console.error(error);
    } finally {
      if (!options.silent) wx.hideLoading();
    }
  },

  refreshDerived() {
    const visibleProducts = this.data.activeCategory === "全部"
      ? this.data.products
      : this.data.products.filter((item) => item.category === this.data.activeCategory);
    const cartRows = Object.entries(this.data.cart)
      .map(([id, quantity]) => ({
        product: this.data.products.find((item) => item.id === id),
        quantity
      }))
      .filter((row) => row.product && row.quantity > 0);
    const cartCount = cartRows.reduce((sum, row) => sum + row.quantity, 0);
    const cartTotal = cartRows.reduce((sum, row) => sum + Number(row.product.price || 0) * row.quantity, 0);
    const currentMember = this.data.currentMember
      ? { ...this.data.currentMember, balanceText: money(this.data.currentMember.balance) }
      : null;
    const deliveryFee = this.data.fulfillmentType === "delivery" && cartTotal < this.data.deliverySettings.freeThreshold
      ? this.data.deliverySettings.fee
      : 0;
    const payableTotal = Number((cartTotal + deliveryFee).toFixed(2));
    const deliveryFeeHint = this.data.fulfillmentType !== "delivery" ? "" : deliveryFee === 0
      ? `已满 ¥${money(this.data.deliverySettings.freeThreshold)}，配送费已减免`
      : `配送费 ¥${money(deliveryFee)}；再点 ¥${money(Math.max(0, this.data.deliverySettings.freeThreshold - cartTotal))} 可免配送费`;
    this.setData({
      visibleProducts,
      cartRows,
      cartCount,
      cartTotal,
      cartTotalText: money(cartTotal),
      deliveryFee,
      deliveryFeeText: money(deliveryFee),
      payableTotal,
      payableTotalText: money(payableTotal),
      deliveryFeeHint,
      currentMember,
      memberText: currentMember
        ? `${currentMember.name || "会员"} · 会员号 ${currentMember.card || ""} · 余额 ¥${money(currentMember.balance)}`
        : "未加入会员，付款或充值后可自动建档"
    });
  },

  setCategory(event) {
    this.setData({ activeCategory: event.currentTarget.dataset.name });
    this.refreshDerived();
  },

  addToCart(event) {
    const id = event.currentTarget.dataset.id;
    const shouldShowFeedback =
      event.currentTarget.dataset.feedback === true ||
      event.currentTarget.dataset.feedback === "true";
    const shouldOpenCart = this.data.cartCount === 0 && !this.data.cartExpanded;
    const cart = { ...this.data.cart, [id]: Number(this.data.cart[id] || 0) + 1 };
    this.setData({
      cart,
      cartExpanded: shouldOpenCart || this.data.cartExpanded,
      addedProductId: shouldShowFeedback ? id : this.data.addedProductId
    });
    this.refreshDerived();
    if (shouldShowFeedback) {
      wx.vibrateShort({ type: "light" });
      wx.showToast({ title: `已加入，共 ${cart[id]} 件`, icon: "success", duration: 900 });
      clearTimeout(this.addFeedbackTimer);
      this.addFeedbackTimer = setTimeout(() => {
        this.setData({ addedProductId: "" });
      }, 1000);
    }
  },

  decreaseCart(event) {
    const id = event.currentTarget.dataset.id;
    const next = Number(this.data.cart[id] || 0) - 1;
    const cart = { ...this.data.cart };
    if (next <= 0) delete cart[id];
    else cart[id] = next;
    this.setData({ cart });
    this.refreshDerived();
  },

  async setFulfillment(event) {
    const fulfillmentType = event.currentTarget.dataset.type;
    this.setData({ fulfillmentType, deliveryAreaConfirmed: false });
    this.refreshDerived();
    if (fulfillmentType === "delivery") await this.requestDeliveryLocation();
  },

  async requestDeliveryLocation() {
    this.setData({ locationStatus: "正在打开地图，请确认配送地址…" });
    try {
      const location = await wx.chooseLocation();
      const settings = this.data.deliverySettings;
      if (!Number.isFinite(settings.storeLatitude) || !Number.isFinite(settings.storeLongitude)) {
        this.setData({ locationStatus: "门店尚未配置配送定位，请联系店员" });
        return false;
      }
      const distanceKm = calculateDistanceKm(settings.storeLatitude, settings.storeLongitude, location.latitude, location.longitude);
      this.setData({
        deliveryLatitude: location.latitude,
        deliveryLongitude: location.longitude,
        deliveryDistanceKm: Number(distanceKm.toFixed(2)),
        deliveryAddress: formatChosenAddress(location),
        locationStatus: distanceKm <= 3
          ? `定位成功，距门店 ${distanceKm.toFixed(1)} 公里，可配送`
          : `距门店 ${distanceKm.toFixed(1)} 公里，超出 3 公里配送范围`
      });
      return distanceKm <= 3;
    } catch (error) {
      const cancelled = String(error?.errMsg || error?.message || "").includes("cancel");
      this.setData({ locationStatus: cancelled ? "尚未选择配送地址，请重新定位" : "未获得定位，请授权定位后重试" });
      wx.showToast({ title: cancelled ? "请选择配送地址" : "配送下单需要定位授权", icon: "none" });
      return false;
    }
  },

  setPickupMode(event) {
    this.setData({ pickupMode: event.currentTarget.dataset.mode });
  },

  setPickupDate(event) {
    this.setData({ pickupDate: event.detail.value });
  },

  setPickupTime(event) {
    this.setData({ pickupTime: event.detail.value });
  },

  setDeliveryAddress(event) {
    this.setData({ deliveryAddress: event.detail.value });
  },

  setDeliveryRecipientName(event) {
    this.setData({ deliveryRecipientName: event.detail.value });
  },

  setDeliveryRecipientPhone(event) {
    this.setData({ deliveryRecipientPhone: event.detail.value });
  },

  setMemberName(event) {
    this.setData({ memberNameInput: event.detail.value });
  },

  setDeliveryAreaConfirmed(event) {
    this.setData({ deliveryAreaConfirmed: event.detail.value.includes("confirmed") });
  },

  setDeliveryDate(event) {
    this.setData({ deliveryDate: event.detail.value });
  },

  setDeliveryTime(event) {
    this.setData({ deliveryTime: event.detail.value });
  },

  setOrderNote(event) {
    this.setData({ orderNote: event.detail.value });
  },

  setPaymentMethod(event) {
    this.setData({ paymentMethod: event.detail.value });
  },

  toggleCart() {
    this.setData({ cartExpanded: !this.data.cartExpanded });
  },

  closeCart() {
    this.setData({ cartExpanded: false });
  },

  noop() {},

  openMemberJoin() {
    const savedName = String(this.data.memberNameInput || wx.getStorageSync?.("aiwa_member_name") || "").trim();
    this.setData({
      authRequired: true,
      memberNameInput: savedName,
      needsMemberName: !savedName,
      cartExpanded: false
    });
  },

  closeMemberJoin() {
    if (!this.data.authSubmitting) this.setData({ authRequired: false });
  },

  openRecharge() {
    if (!this.data.currentMember) {
      this.openMemberJoin();
      return;
    }
    this.setData({ rechargeOpen: true, cartExpanded: false });
  },

  closeRecharge() {
    if (!this.data.rechargeSubmitting) this.setData({ rechargeOpen: false });
  },

  chooseRechargeAmount(event) {
    this.setData({ rechargeAmount: String(event.currentTarget.dataset.amount) });
  },

  setRechargeAmount(event) {
    this.setData({ rechargeAmount: event.detail.value });
  },

  async submitRecharge() {
    const member = this.data.currentMember;
    const amount = Number(this.data.rechargeAmount);
    if (!member) {
      wx.showToast({ title: "请先加入会员", icon: "none" });
      return;
    }
    if (!Number.isFinite(amount) || amount < 0.01 || amount > 5000) {
      wx.showToast({ title: "请输入 0.01 至 5000 元", icon: "none" });
      return;
    }
    if (this.data.rechargeSubmitting) return;

    const rechargeNo = buildRechargeNo();
    this.setData({ rechargeSubmitting: true });
    wx.showLoading({ title: "发起充值" });
    try {
      const payResult = await this.callPayFunction("createJsapiOrder", {
        description: "爱娃披萨会员充值",
        out_trade_no: rechargeNo,
        amount: {
          total: yuanToFen(amount),
          currency: "CNY"
        },
        attach: `recharge:${member.id}`
      });
      if (payResult.ok === false || payResult.code > 0) {
        throw new Error(payResult.message || payResult.msg || "充值下单失败");
      }

      const payment = payResult.payment || payResult.data?.payment || payResult.data?.data || payResult.data || payResult;
      if (!payment) throw new Error("支付参数为空");
      wx.hideLoading();
      await wx.requestPayment({
        timeStamp: String(payment.timeStamp),
        nonceStr: payment.nonceStr,
        package: payment.package,
        signType: payment.signType,
        paySign: payment.paySign
      });

      wx.showLoading({ title: "充值入账" });
      const result = await this.callPayFunction("confirmJsapiOrder", {
        out_trade_no: rechargeNo
      });
      if (!result?.ok || result.type !== "recharge") throw new Error(result?.message || "充值入账失败");

      this.setData({
        currentMember: result.member || member,
        rechargeOpen: false
      });
      this.refreshDerived();
      await this.loadStoreData({ silent: true });
      wx.showToast({ title: "充值成功", icon: "success" });
    } catch (error) {
      console.error(error);
      wx.showToast({
        title: String(error.errMsg || error.message || "充值未完成").includes("cancel") ? "已取消充值" : (error.message || "充值未完成"),
        icon: "none"
      });
    } finally {
      wx.hideLoading();
      this.setData({ rechargeSubmitting: false });
    }
  },

  async joinMember(event) {
    const name = this.data.memberNameInput.trim();
    if (!name) {
      wx.showToast({ title: "请先填写会员昵称", icon: "none" });
      return;
    }
    const phoneCode = event.detail?.code;
    if (!phoneCode) {
      wx.showToast({ title: "需要授权手机号才能加入会员", icon: "none" });
      return;
    }

    this.setData({ authSubmitting: true });
    wx.showLoading({ title: "正在登录" });
    try {
      const result = await withTimeout(wx.cloud.callFunction({
        name: app.globalData.membershipFunction,
        data: {
          action: "joinMiniProgramMember",
          payload: {
            phoneCode,
            storeId: app.globalData.storeId,
            name
          }
        }
      }), 8000, "手机号授权响应超时，请检查网络后重新授权");
      if (!result.result?.ok) throw new Error(result.result?.message || "加入会员失败");
      const customer = { ...this.data.customer, ...(result.result.customer || {}), name: result.result.member?.name || name };
      wx.setStorageSync?.("aiwa_member_name", customer.name);
      app.globalData.customer = customer;
      this.setData({ customer, currentMember: result.result.member || null, authRequired: false });
      this.refreshDerived();
      wx.hideLoading();
      this.setData({ authSubmitting: false });
      wx.showToast({ title: "登录成功", icon: "success" });
      this.loadStoreData({ silent: true }).catch((error) => console.error("刷新会员数据失败", error));
    } catch (error) {
      console.error(error);
      wx.hideLoading();
      this.setData({ authSubmitting: false });
      wx.showModal({
        title: "手机号授权未完成",
        content: error.message || "请检查网络后重新点击手机号授权登录。",
        confirmText: "我知道了",
        showCancel: false
      });
    }
  },

  goOrders() {
    wx.navigateTo({ url: "/pages/orders/orders" });
  },

  closeOrderSuccess() {
    this.setData({ orderSuccessOpen: false });
  },

  viewSuccessfulOrder() {
    this.setData({ orderSuccessOpen: false });
    this.goOrders();
  },

  showOrderSuccess(order = {}) {
    const isDelivery = order.fulfillmentType === "delivery";
    this.setData({
      orderSuccessOpen: true,
      orderSuccessNo: order.orderNo || "",
      orderSuccessMessage: isDelivery
        ? "订单已提交，店家接单后将按填写的信息配送。"
        : "订单已提交，请留意订单状态并按时到店取餐。"
    });
  },

  async submitOrder() {
    if (!this.data.cartRows.length) {
      wx.showToast({ title: "请先选择商品", icon: "none" });
      return;
    }
    if (this.data.fulfillmentType === "pickup" && this.data.pickupMode === "scheduled" && (!this.data.pickupDate || !this.data.pickupTime)) {
      wx.showToast({ title: "请选择预约取餐时间", icon: "none" });
      return;
    }
    if (this.data.fulfillmentType === "delivery" && !this.data.deliveryAddress.trim()) {
      wx.showToast({ title: "请填写配送地址", icon: "none" });
      return;
    }
    if (this.data.fulfillmentType === "delivery" && !this.data.deliveryRecipientName.trim()) {
      wx.showToast({ title: "请填写收货人姓名", icon: "none" });
      return;
    }
    if (this.data.fulfillmentType === "delivery" && !/^1\d{10}$/.test(this.data.deliveryRecipientPhone.trim())) {
      wx.showToast({ title: "请填写正确的收货人手机号", icon: "none" });
      return;
    }
    if (this.data.fulfillmentType === "delivery" && !this.data.deliveryAreaConfirmed) {
      wx.showToast({ title: "请确认地址属于可配送区域", icon: "none" });
      return;
    }
    if (this.data.fulfillmentType === "delivery") {
      if (!Number.isFinite(this.data.deliveryLatitude) || !Number.isFinite(this.data.deliveryLongitude)) {
        const located = await this.requestDeliveryLocation();
        if (!located) return;
      }
      if (Number(this.data.deliveryDistanceKm) > 3) {
        wx.showToast({ title: "超出 3 公里配送范围", icon: "none" });
        return;
      }
    }

    if (!this.data.currentMember || !this.data.customer?.phone) {
      this.openMemberJoin();
      wx.showToast({ title: "结算前请先验证手机号", icon: "none" });
      return;
    }

    if (this.data.paymentMethod === "wechat_pay") {
      await this.payWithWechat();
      return;
    }

    await this.payWithMemberBalance();
  },

  async payWithMemberBalance() {
    wx.showLoading({ title: "提交订单" });
    try {
      const result = await wx.cloud.callFunction({
        name: app.globalData.membershipFunction,
        data: {
          action: "createMiniProgramOrder",
          payload: this.buildOrderDraft()
        }
      });
      if (!result.result?.ok) throw new Error(result.result?.message || "订单提交失败");
      this.setData({ cart: {}, orderNote: "", cartExpanded: false });
      this.refreshDerived();
      this.showOrderSuccess(result.result.order);
      await this.loadStoreData({ silent: true });
    } catch (error) {
      wx.showToast({ title: error.message || "提交失败", icon: "none" });
      console.error(error);
    } finally {
      wx.hideLoading();
    }
  },

  async payWithWechat() {
    if (!app.globalData.payFunction) {
      wx.showModal({
        title: "支付集成未配置",
        content: "请先配置直连商户模式微信支付云函数 partnerPay 所需的支付参数。",
        showCancel: false
      });
      return;
    }

    wx.showLoading({ title: "发起支付" });
    let pendingOrder = null;
    let paymentCompleted = false;
    try {
      const orderDraft = this.buildOrderDraft();
      const pendingResult = await wx.cloud.callFunction({
        name: app.globalData.membershipFunction,
        data: {
          action: "createMiniProgramPendingOrder",
          payload: orderDraft
        }
      });
      if (!pendingResult.result?.ok) throw new Error(pendingResult.result?.message || "订单创建失败");

      pendingOrder = pendingResult.result.order;
      const payResult = await this.callPayFunction("createJsapiOrder", {
        description: buildPaymentDescription(pendingOrder),
        out_trade_no: pendingOrder.orderNo,
        amount: {
          total: yuanToFen(pendingOrder.totalAmount),
          currency: "CNY"
        }
      });
      if (payResult.ok === false || payResult.code > 0) {
        throw new Error(payResult.message || payResult.msg || "微信支付下单失败");
      }

      const payment = payResult.payment || payResult.data?.payment || payResult.data?.data || payResult.data || payResult;
      if (!payment) throw new Error("支付参数为空");
      await wx.requestPayment({
        timeStamp: String(payment.timeStamp),
        nonceStr: payment.nonceStr,
        package: payment.package,
        signType: payment.signType,
        paySign: payment.paySign
      });
      paymentCompleted = true;

      wx.showLoading({ title: "确认支付结果" });
      const confirmResult = await this.confirmWechatPayment(pendingOrder.orderNo);
      if (!confirmResult?.ok) throw new Error(confirmResult?.message || "支付结果确认失败");
      this.setData({ cart: {}, orderNote: "", cartExpanded: false });
      this.refreshDerived();
      this.showOrderSuccess(confirmResult.order || pendingOrder);
      await this.loadStoreData({ silent: true });
    } catch (error) {
      if (paymentCompleted && pendingOrder) {
        this.setData({ cart: {}, orderNote: "", cartExpanded: false });
        this.refreshDerived();
        this.showOrderSuccess(pendingOrder);
        this.setData({
          orderSuccessMessage: "微信支付已完成，订单正在确认中。请勿重复支付，可在“我的订单”查看最新状态。"
        });
      } else {
        wx.showToast({ title: "支付未完成", icon: "none" });
      }
      console.error(error);
    } finally {
      wx.hideLoading();
    }
  },

  async confirmWechatPayment(orderNo) {
    const retryDelays = [0, 500, 1000, 1600, 2400, 3500, 5000];
    let lastResult = null;
    for (const delay of retryDelays) {
      if (delay) await wait(delay);
      lastResult = await this.callPayFunction("confirmJsapiOrder", { out_trade_no: orderNo });
      if (lastResult?.ok) return lastResult;
    }
    return lastResult;
  },

  callPayFunction(apiName, data) {
    if (app.globalData.payCallType === "cloudFunction") {
      return wx.cloud.callFunction({
        name: app.globalData.payFunction,
        data: {
          action: apiName,
          payload: data
        }
      }).then((res) => res.result);
    }

    return new Promise((resolve, reject) => {
      wx.cloud.callHTTPFunction({
        name: app.globalData.payFunction,
        config: { env: app.globalData.envId },
        method: "POST",
        header: { "Content-Type": "application/json" },
        path: app.globalData.payOrderPath || `/wx-pay/${apiName}`,
        data,
        success: (res) => resolve(res.data),
        fail: reject
      });
    });
  },

  buildOrderDraft() {
    const deliveryFee = this.data.fulfillmentType === "delivery" && this.data.cartTotal < this.data.deliverySettings.freeThreshold
      ? this.data.deliverySettings.fee
      : 0;
    const payableTotal = Number((this.data.cartTotal + deliveryFee).toFixed(2));
    return {
      customer: this.data.customer,
      storeId: this.data.store?.id || app.globalData.storeId || "",
      items: this.data.cartRows.map((row) => ({
        productId: row.product.id,
        name: row.product.name,
        category: row.product.category,
        price: Number(row.product.price),
        quantity: row.quantity
      })),
      goodsAmount: this.data.cartTotal,
      totalAmount: payableTotal,
      deliveryFee,
      fulfillmentType: this.data.fulfillmentType,
      pickupMode: this.data.pickupMode,
      pickupDate: this.data.pickupDate,
      pickupTime: this.data.pickupTime,
      deliveryAddress: this.data.deliveryAddress,
      deliveryRecipientName: this.data.deliveryRecipientName,
      deliveryRecipientPhone: this.data.deliveryRecipientPhone,
      deliveryDate: this.data.deliveryDate,
      deliveryTime: this.data.deliveryTime,
      deliveryLatitude: this.data.deliveryLatitude,
      deliveryLongitude: this.data.deliveryLongitude,
      note: this.data.orderNote,
      paymentMethod: this.data.paymentMethod,
      createdAt: new Date().toISOString()
    };
  }
});

function money(value) {
  return Number(value || 0).toFixed(2);
}

function formatChosenAddress(location = {}) {
  const name = String(location.name || "").trim();
  const address = String(location.address || "").trim();
  if (name && address && !address.includes(name)) return `${address}${name}`;
  return address || name;
}

function normalizeDeliverySettings(settings = {}) {
  const latitude = settings.storeLatitude === null || settings.storeLatitude === undefined ? null : Number(settings.storeLatitude);
  const longitude = settings.storeLongitude === null || settings.storeLongitude === undefined ? null : Number(settings.storeLongitude);
  return {
    fee: Math.max(0, Number.isFinite(Number(settings.fee)) ? Number(settings.fee) : 5),
    freeThreshold: Math.max(0, Number.isFinite(Number(settings.freeThreshold)) ? Number(settings.freeThreshold) : 58),
    maxDistanceKm: 3,
    storeLatitude: Number.isFinite(latitude) ? latitude : null,
    storeLongitude: Number.isFinite(longitude) ? longitude : null,
    testMode: settings.testMode === true,
  };
}

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const deltaLat = radians(lat2 - lat1);
  const deltaLon = radians(lon2 - lon1);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(deltaLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function yuanToFen(value) {
  return Math.round(Number(value || 0) * 100);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout(promise, milliseconds, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), milliseconds))
  ]);
}

function buildPaymentDescription(order) {
  const names = (order.items || []).map((item) => item.name).filter(Boolean);
  const description = names.length ? names.slice(0, 2).join("、") : "爱娃披萨订单";
  return description.slice(0, 42);
}

function buildRechargeNo() {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return `RC${date}${String(Date.now()).slice(-8)}`;
}
