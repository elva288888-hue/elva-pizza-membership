const STORAGE_KEY = "aiwa_drink_membership_v1";

const state = {
  members: [],
  records: [],
  settings: {
    bonusRules: [],
  },
  activeView: "dashboard",
};

const els = {
  navItems: document.querySelectorAll(".nav-item"),
  pageTitle: document.querySelector("#pageTitle"),
  views: {
    dashboard: document.querySelector("#dashboardView"),
    members: document.querySelector("#membersView"),
    records: document.querySelector("#recordsView"),
    settings: document.querySelector("#settingsView"),
  },
  memberCount: document.querySelector("#memberCount"),
  totalBalance: document.querySelector("#totalBalance"),
  todayRecharge: document.querySelector("#todayRecharge"),
  todaySpend: document.querySelector("#todaySpend"),
  quickTransactionForm: document.querySelector("#quickTransactionForm"),
  quickMember: document.querySelector("#quickMember"),
  quickType: document.querySelector("#quickType"),
  quickAmount: document.querySelector("#quickAmount"),
  quickNote: document.querySelector("#quickNote"),
  recentRecords: document.querySelector("#recentRecords"),
  memberSearch: document.querySelector("#memberSearch"),
  recordSearch: document.querySelector("#recordSearch"),
  recordTypeFilter: document.querySelector("#recordTypeFilter"),
  recordStartDate: document.querySelector("#recordStartDate"),
  recordEndDate: document.querySelector("#recordEndDate"),
  clearRecordDates: document.querySelector("#clearRecordDates"),
  printFilteredRecords: document.querySelector("#printFilteredRecords"),
  memberList: document.querySelector("#memberList"),
  recordTable: document.querySelector("#recordTable"),
  bonusRuleForm: document.querySelector("#bonusRuleForm"),
  ruleMinAmount: document.querySelector("#ruleMinAmount"),
  ruleBonusAmount: document.querySelector("#ruleBonusAmount"),
  bonusRuleList: document.querySelector("#bonusRuleList"),
  addMember: document.querySelector("#addMember"),
  addMemberTop: document.querySelector("#addMemberTop"),
  memberDialog: document.querySelector("#memberDialog"),
  memberDialogTitle: document.querySelector("#memberDialogTitle"),
  memberForm: document.querySelector("#memberForm"),
  memberId: document.querySelector("#memberId"),
  memberName: document.querySelector("#memberName"),
  memberPhone: document.querySelector("#memberPhone"),
  memberCard: document.querySelector("#memberCard"),
  memberBalance: document.querySelector("#memberBalance"),
  memberNote: document.querySelector("#memberNote"),
  saveMember: document.querySelector("#saveMember"),
  exportData: document.querySelector("#exportData"),
  importData: document.querySelector("#importData"),
  receiptPrintArea: document.querySelector("#receiptPrintArea"),
};

const viewTitles = {
  dashboard: "总览",
  members: "会员",
  records: "流水",
  settings: "设置",
};

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    state.members = [
      createMember("示例会员", "13800000000", "AW0001", 100, "少冰三分糖"),
    ];
    state.records = [
      createRecord(state.members[0].id, "recharge", 100, 100, "开卡充值"),
    ];
    saveState();
    return;
  }

  try {
    const parsed = JSON.parse(saved);
    state.members = Array.isArray(parsed.members) ? parsed.members : [];
    state.records = Array.isArray(parsed.records) ? parsed.records : [];
    state.settings = normalizeSettings(parsed.settings);
    state.records = state.records.map(normalizeRecord);
  } catch {
    state.members = [];
    state.records = [];
    state.settings = normalizeSettings();
  }
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ members: state.members, records: state.records, settings: state.settings })
  );
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function createMember(name, phone, card, balance, note) {
  return {
    id: createId("member"),
    name,
    phone,
    card: card || nextCardNumber(),
    balance: Number(balance) || 0,
    note: note || "",
    createdAt: new Date().toISOString(),
  };
}

function createRecord(memberId, type, amount, balanceAfter, note, bonusAmount = 0) {
  return {
    id: createId("record"),
    memberId,
    type,
    amount: Number(amount),
    bonusAmount: Number(bonusAmount) || 0,
    balanceAfter: Number(balanceAfter),
    note: note || "",
    createdAt: new Date().toISOString(),
  };
}

function normalizeSettings(settings = {}) {
  const bonusRules = Array.isArray(settings.bonusRules)
    ? settings.bonusRules
        .map((rule) => ({
          id: rule.id || createId("rule"),
          minAmount: Number(rule.minAmount),
          bonusAmount: Number(rule.bonusAmount),
        }))
        .filter((rule) => rule.minAmount > 0 && rule.bonusAmount >= 0)
        .sort((a, b) => a.minAmount - b.minAmount)
    : [];
  return { bonusRules };
}

function normalizeRecord(record) {
  return {
    ...record,
    amount: Number(record.amount) || 0,
    bonusAmount: Number(record.bonusAmount) || 0,
    balanceAfter: Number(record.balanceAfter) || 0,
  };
}

function recordTypeLabel(type) {
  const labels = {
    recharge: "充值",
    spend: "消费",
    adjust: "调整",
  };
  return labels[type] || "流水";
}

function recordAmountText(record) {
  if (record.type === "spend") return `-${money(record.amount)}`;
  if (record.type === "adjust") {
    const prefix = record.amount >= 0 ? "+" : "-";
    return `${prefix}${money(Math.abs(record.amount))}`;
  }
  return `+${money(record.amount)}`;
}

function recordBonusText(record) {
  return record.bonusAmount ? `+${money(record.bonusAmount)}` : "-";
}

function getRechargeBonus(amount) {
  const value = Number(amount) || 0;
  const matched = [...state.settings.bonusRules]
    .filter((rule) => value >= rule.minAmount)
    .sort((a, b) => b.minAmount - a.minAmount)[0];
  return matched ? matched.bonusAmount : 0;
}

function getRecordDateRange() {
  return {
    start: els.recordStartDate.value ? new Date(`${els.recordStartDate.value}T00:00:00`) : null,
    end: els.recordEndDate.value ? new Date(`${els.recordEndDate.value}T23:59:59`) : null,
  };
}

function isRecordInDateRange(record, range = getRecordDateRange()) {
  const createdAt = new Date(record.createdAt);
  if (range.start && createdAt < range.start) return false;
  if (range.end && createdAt > range.end) return false;
  return true;
}

function recordDateRangeLabel(range = getRecordDateRange()) {
  const start = els.recordStartDate.value || "不限";
  const end = els.recordEndDate.value || "不限";
  return `日期：${start} 至 ${end}`;
}

function recordSearchLabel() {
  return els.recordSearch.value.trim() || "不限";
}

function recordTypeFilterLabel() {
  return els.recordTypeFilter.value === "all" ? "全部类型" : recordTypeLabel(els.recordTypeFilter.value);
}

function getFilteredRecords() {
  const keyword = els.recordSearch.value.trim().toLowerCase();
  const type = els.recordTypeFilter.value;
  return [...state.records]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .filter((record) => {
      const member = getMember(record.memberId);
      const typeText = recordTypeLabel(record.type);
      const text = `${member?.name || "已删除会员"} ${member?.phone || ""} ${member?.card || ""} ${record.note} ${typeText}`.toLowerCase();
      return (type === "all" || record.type === type) && text.includes(keyword) && isRecordInDateRange(record);
    });
}

function nextCardNumber() {
  const next = state.members.length + 1;
  return `AW${String(next).padStart(4, "0")}`;
}

function money(value) {
  return `¥${Number(value || 0).toFixed(2)}`;
}

function formatTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatFullTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function isToday(value) {
  const date = new Date(value);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function getMember(memberId) {
  return state.members.find((member) => member.id === memberId);
}

function render() {
  renderNavigation();
  renderDashboard();
  renderMembers();
  renderRecords();
  renderQuickMembers();
  renderBonusRules();
}

function renderNavigation() {
  els.pageTitle.textContent = viewTitles[state.activeView];
  for (const [view, element] of Object.entries(els.views)) {
    element.classList.toggle("active-view", view === state.activeView);
  }
  els.navItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.view === state.activeView);
  });
}

function renderDashboard() {
  const todayRecords = state.records.filter((record) => isToday(record.createdAt));
  const todayRecharge = todayRecords
    .filter((record) => record.type === "recharge")
    .reduce((sum, record) => sum + record.amount, 0);
  const todaySpend = todayRecords
    .filter((record) => record.type === "spend")
    .reduce((sum, record) => sum + record.amount, 0);
  const totalBalance = state.members.reduce((sum, member) => sum + member.balance, 0);

  els.memberCount.textContent = String(state.members.length);
  els.totalBalance.textContent = money(totalBalance);
  els.todayRecharge.textContent = money(todayRecharge);
  els.todaySpend.textContent = money(todaySpend);

  const recent = [...state.records]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 6);

  if (!recent.length) {
    els.recentRecords.className = "record-list empty-state";
    els.recentRecords.textContent = "暂无记录";
    return;
  }

  els.recentRecords.className = "record-list";
  els.recentRecords.innerHTML = recent.map(recordTemplate).join("");
}

function renderQuickMembers() {
  if (!state.members.length) {
    els.quickMember.innerHTML = '<option value="">请先新增会员</option>';
    els.quickMember.disabled = true;
    return;
  }

  els.quickMember.disabled = false;
  els.quickMember.innerHTML = state.members
    .map(
      (member) =>
        `<option value="${member.id}">${escapeHtml(member.name)} - ${escapeHtml(member.card)} - ${money(member.balance)}</option>`
    )
    .join("");
}

function renderMembers() {
  const keyword = els.memberSearch.value.trim().toLowerCase();
  const members = state.members.filter((member) => {
    const text = `${member.name} ${member.phone} ${member.card}`.toLowerCase();
    return text.includes(keyword);
  });

  if (!members.length) {
    els.memberList.className = "member-list empty-state";
    els.memberList.textContent = state.members.length ? "没有匹配的会员" : "暂无会员";
    return;
  }

  els.memberList.className = "member-list";
  els.memberList.innerHTML = members
    .map(
      (member) => `
        <article class="member-card">
          <header>
            <div>
              <h3>${escapeHtml(member.name)}</h3>
              <p>${escapeHtml(member.phone)} · ${escapeHtml(member.card)}</p>
            </div>
            <div class="balance">${money(member.balance)}</div>
          </header>
          <p>${escapeHtml(member.note || "暂无备注")}</p>
          <div class="card-actions">
            <button class="mini-button" data-action="recharge" data-id="${member.id}" type="button">充值</button>
            <button class="mini-button" data-action="spend" data-id="${member.id}" type="button">消费</button>
            <button class="mini-button" data-action="edit" data-id="${member.id}" type="button">编辑</button>
            <button class="mini-button" data-action="print-member" data-id="${member.id}" type="button">打印记录</button>
          </div>
        </article>
      `
    )
    .join("");
}

function renderRecords() {
  const records = getFilteredRecords();

  if (!records.length) {
    els.recordTable.innerHTML = `
      <tr>
        <td colspan="7" class="empty-state">暂无流水</td>
      </tr>
    `;
    return;
  }

  els.recordTable.innerHTML = records
    .map((record) => {
      const member = getMember(record.memberId);
      const amountText = recordAmountText(record);
      return `
        <tr>
          <td>${formatTime(record.createdAt)}</td>
          <td>${escapeHtml(member?.name || "已删除会员")}</td>
          <td>${recordTypeLabel(record.type)}</td>
          <td class="record-amount ${record.type}">${amountText}</td>
          <td class="record-amount recharge">${recordBonusText(record)}</td>
          <td>${money(record.balanceAfter)}</td>
          <td>${escapeHtml(record.note || "-")}</td>
        </tr>
      `;
    })
    .join("");
}

function recordTemplate(record) {
  const member = getMember(record.memberId);
  const amountText = recordAmountText(record);
  return `
    <article class="record-item">
      <div>
        <strong>${escapeHtml(member?.name || "已删除会员")} · ${recordTypeLabel(record.type)}</strong>
        <span>${formatTime(record.createdAt)} · 余额 ${money(record.balanceAfter)}</span>
        ${record.note ? `<p>${escapeHtml(record.note)}</p>` : ""}
      </div>
      <div class="record-amount ${record.type}">${amountText}</div>
    </article>
  `;
}

function renderBonusRules() {
  const rules = [...state.settings.bonusRules].sort((a, b) => a.minAmount - b.minAmount);
  if (!rules.length) {
    els.bonusRuleList.className = "rule-list empty-state";
    els.bonusRuleList.textContent = "暂无赠送规则";
    return;
  }

  els.bonusRuleList.className = "rule-list";
  els.bonusRuleList.innerHTML = rules
    .map(
      (rule) => `
        <article class="rule-item">
          <strong>充值满 ${money(rule.minAmount)} 赠送 ${money(rule.bonusAmount)}</strong>
          <button class="mini-button danger-button" data-delete-rule="${rule.id}" type="button">删除</button>
        </article>
      `
    )
    .join("");
}

function switchView(view) {
  state.activeView = view;
  render();
}

function openMemberDialog(member) {
  els.memberDialogTitle.textContent = member ? "编辑会员" : "新增会员";
  els.memberId.value = member?.id || "";
  els.memberName.value = member?.name || "";
  els.memberPhone.value = member?.phone || "";
  els.memberCard.value = member?.card || "";
  els.memberBalance.value = member ? member.balance : 0;
  els.memberNote.value = member?.note || "";
  els.memberDialog.showModal();
}

function saveMemberFromForm() {
  const id = els.memberId.value;
  const name = els.memberName.value.trim();
  const phone = els.memberPhone.value.trim();
  const card = els.memberCard.value.trim();
  const balance = Number(els.memberBalance.value || 0);
  const note = els.memberNote.value.trim();

  if (!name || !phone) {
    alert("请填写姓名和手机号");
    return;
  }

  if (balance < 0) {
    alert("初始余额不能小于 0");
    return;
  }

  if (id) {
    const member = getMember(id);
    if (!member) return;
    const previousBalance = Number(member.balance);
    Object.assign(member, { name, phone, card: card || member.card, balance, note });
    if (previousBalance !== balance) {
      state.records.push(createRecord(id, "adjust", balance - previousBalance, balance, "手动调整余额"));
    }
  } else {
    const member = createMember(name, phone, card, balance, note);
    state.members.push(member);
    if (balance > 0) {
      state.records.push(createRecord(member.id, "recharge", balance, balance, "开卡初始余额"));
    }
  }

  saveState();
  els.memberDialog.close();
  render();
}

function addTransaction(memberId, type, amount, note) {
  const member = getMember(memberId);
  const value = Number(amount);
  if (!member) {
    alert("请选择会员");
    return false;
  }
  if (!Number.isFinite(value) || value <= 0) {
    alert("请输入大于 0 的金额");
    return false;
  }
  if (type === "spend" && member.balance < value) {
    alert("余额不足，无法消费");
    return false;
  }

  const bonusAmount = type === "recharge" ? getRechargeBonus(value) : 0;
  const balanceChange = type === "recharge" ? value + bonusAmount : -value;
  member.balance += balanceChange;
  const finalNote =
    type === "recharge" && bonusAmount > 0
      ? `${note || "充值"}，赠送 ${money(bonusAmount)}`
      : note;
  const record = createRecord(member.id, type, value, member.balance, finalNote, bonusAmount);
  state.records.push(record);
  saveState();
  render();
  return record;
}

function getRecord(recordId) {
  return state.records.find((record) => record.id === recordId);
}

function receiptLine(label, value) {
  return `
    <div class="receipt-line">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function printMemberStatement(memberId, useCurrentDateRange = false) {
  const member = getMember(memberId);
  if (!member) {
    alert("没有找到这个会员");
    return;
  }

  const range = useCurrentDateRange ? getRecordDateRange() : { start: null, end: null };
  const records = state.records
    .filter((record) => record.memberId === memberId && isRecordInDateRange(record, range))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  if (!records.length) {
    alert("该会员在当前范围内没有交易记录");
    return;
  }

  const totalRecharge = records
    .filter((record) => record.type === "recharge")
    .reduce((sum, record) => sum + record.amount, 0);
  const totalBonus = records.reduce((sum, record) => sum + (record.bonusAmount || 0), 0);
  const totalSpend = records
    .filter((record) => record.type === "spend")
    .reduce((sum, record) => sum + record.amount, 0);
  const statementNo = `${member.card}-${Date.now().toString().slice(-6)}`;

  els.receiptPrintArea.innerHTML = `
    <div class="receipt">
      <img class="receipt-logo" src="assets/aiwa-pizza-logo.jpg" alt="">
      <h2>爱娃披萨店</h2>
      <p class="receipt-subtitle">会员交易记录</p>
      <div class="receipt-dashed"></div>
      ${receiptLine("单号", statementNo)}
      ${receiptLine("打印时间", formatFullTime(new Date().toISOString()))}
      ${receiptLine("范围", useCurrentDateRange ? recordDateRangeLabel(range) : "全部交易")}
      ${receiptLine("会员", member.name)}
      ${receiptLine("手机号", member.phone)}
      ${receiptLine("卡号", member.card)}
      <div class="receipt-dashed"></div>
      ${receiptLine("充值合计", money(totalRecharge))}
      ${receiptLine("赠送合计", money(totalBonus))}
      ${receiptLine("消费合计", money(totalSpend))}
      ${receiptLine("当前余额", money(member.balance))}
      <div class="receipt-dashed"></div>
      <div class="receipt-records">
        ${records
          .map(
            (record) => `
              <div class="receipt-record">
                <div>
                  <strong>${formatFullTime(record.createdAt)}</strong>
                  <span>${recordTypeLabel(record.type)} ${recordAmountText(record)}${record.bonusAmount ? ` / 赠 ${money(record.bonusAmount)}` : ""}</span>
                  <span>余额 ${money(record.balanceAfter)}</span>
                </div>
                ${record.note ? `<p>${escapeHtml(record.note)}</p>` : ""}
              </div>
            `
          )
          .join("")}
      </div>
      <div class="receipt-dashed"></div>
      <p class="receipt-footer">感谢惠顾，欢迎下次光临</p>
    </div>
  `;
  window.print();
}

function printFilteredRecordStatement() {
  const records = [...getFilteredRecords()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  if (!records.length) {
    alert("当前查询条件下没有可打印的流水");
    return;
  }

  const totalRecharge = records
    .filter((record) => record.type === "recharge")
    .reduce((sum, record) => sum + record.amount, 0);
  const totalBonus = records.reduce((sum, record) => sum + (record.bonusAmount || 0), 0);
  const totalSpend = records
    .filter((record) => record.type === "spend")
    .reduce((sum, record) => sum + record.amount, 0);
  const memberNames = Array.from(
    new Set(records.map((record) => getMember(record.memberId)?.name || "已删除会员"))
  );
  const memberLabel = memberNames.length === 1 ? memberNames[0] : `${memberNames.length} 位会员`;

  els.receiptPrintArea.innerHTML = `
    <div class="receipt">
      <img class="receipt-logo" src="assets/aiwa-pizza-logo.jpg" alt="">
      <h2>爱娃披萨店</h2>
      <p class="receipt-subtitle">流水查询结果</p>
      <div class="receipt-dashed"></div>
      ${receiptLine("打印时间", formatFullTime(new Date().toISOString()))}
      ${receiptLine("会员搜索", recordSearchLabel())}
      ${receiptLine("类型", recordTypeFilterLabel())}
      ${receiptLine("日期范围", recordDateRangeLabel())}
      ${receiptLine("涉及会员", memberLabel)}
      <div class="receipt-dashed"></div>
      ${receiptLine("记录数", `${records.length} 笔`)}
      ${receiptLine("充值合计", money(totalRecharge))}
      ${receiptLine("赠送合计", money(totalBonus))}
      ${receiptLine("消费合计", money(totalSpend))}
      <div class="receipt-dashed"></div>
      <div class="receipt-records">
        ${records
          .map((record) => {
            const member = getMember(record.memberId);
            return `
              <div class="receipt-record">
                <div>
                  <strong>${formatFullTime(record.createdAt)} · ${escapeHtml(member?.name || "已删除会员")}</strong>
                  <span>${recordTypeLabel(record.type)} ${recordAmountText(record)}${record.bonusAmount ? ` / 赠 ${money(record.bonusAmount)}` : ""}</span>
                  <span>余额 ${money(record.balanceAfter)}</span>
                </div>
                ${record.note ? `<p>${escapeHtml(record.note)}</p>` : ""}
              </div>
            `;
          })
          .join("")}
      </div>
      <div class="receipt-dashed"></div>
      <p class="receipt-footer">查询条件对应以上流水</p>
    </div>
  `;
  window.print();
}

function exportData() {
  const blob = new Blob([JSON.stringify({ members: state.members, records: state.records }, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `aiwa-members-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.members) || !Array.isArray(data.records)) {
        throw new Error("Invalid data");
      }
      state.members = data.members;
      state.records = data.records.map(normalizeRecord);
      state.settings = normalizeSettings(data.settings);
      saveState();
      render();
      alert("导入成功");
    } catch {
      alert("导入失败，请选择由本系统导出的 JSON 文件");
    }
  };
  reader.readAsText(file);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

els.navItems.forEach((item) => {
  item.addEventListener("click", () => switchView(item.dataset.view));
});

document.querySelectorAll("[data-view-jump]").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.viewJump));
});

els.addMember.addEventListener("click", () => openMemberDialog());
els.addMemberTop.addEventListener("click", () => openMemberDialog());
els.saveMember.addEventListener("click", saveMemberFromForm);
els.memberSearch.addEventListener("input", renderMembers);
els.recordSearch.addEventListener("input", renderRecords);
els.recordTypeFilter.addEventListener("change", renderRecords);
els.recordStartDate.addEventListener("change", renderRecords);
els.recordEndDate.addEventListener("change", renderRecords);
els.clearRecordDates.addEventListener("click", () => {
  els.recordStartDate.value = "";
  els.recordEndDate.value = "";
  renderRecords();
});
els.printFilteredRecords.addEventListener("click", printFilteredRecordStatement);
els.exportData.addEventListener("click", exportData);
els.importData.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) importData(file);
  event.target.value = "";
});

els.quickTransactionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const record = addTransaction(
    els.quickMember.value,
    els.quickType.value,
    els.quickAmount.value,
    els.quickNote.value.trim()
  );
  if (record) {
    els.quickAmount.value = "";
    els.quickNote.value = "";
    if (event.submitter?.value === "print") {
      printMemberStatement(record.memberId);
    }
  }
});

els.bonusRuleForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const minAmount = Number(els.ruleMinAmount.value);
  const bonusAmount = Number(els.ruleBonusAmount.value);
  if (!Number.isFinite(minAmount) || minAmount <= 0 || !Number.isFinite(bonusAmount) || bonusAmount < 0) {
    alert("请填写正确的充值金额和赠送金额");
    return;
  }
  state.settings.bonusRules.push({ id: createId("rule"), minAmount, bonusAmount });
  state.settings = normalizeSettings(state.settings);
  saveState();
  els.ruleMinAmount.value = "";
  els.ruleBonusAmount.value = "";
  renderBonusRules();
});

els.bonusRuleList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete-rule]");
  if (!button) return;
  state.settings.bonusRules = state.settings.bonusRules.filter((rule) => rule.id !== button.dataset.deleteRule);
  saveState();
  renderBonusRules();
});

els.memberList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const member = getMember(button.dataset.id);
  if (!member) return;

  if (button.dataset.action === "edit") {
    openMemberDialog(member);
    return;
  }

  if (button.dataset.action === "print-member") {
    printMemberStatement(member.id);
    return;
  }

  const label = button.dataset.action === "recharge" ? "充值" : "消费";
  const amount = prompt(`请输入${member.name}本次${label}金额`);
  if (amount === null) return;
  const note = prompt("备注，可留空") || "";
  addTransaction(member.id, button.dataset.action, amount, note);
});

loadState();
render();
