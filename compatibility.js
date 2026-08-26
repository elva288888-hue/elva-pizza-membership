(function () {
  if (!String.prototype.replaceAll) {
    String.prototype.replaceAll = function (search, replacement) {
      return this.split(search).join(replacement);
    };
  }
  if (!Array.prototype.at) {
    Array.prototype.at = function (index) {
      var normalized = Number(index) || 0;
      if (normalized < 0) normalized += this.length;
      return this[normalized];
    };
  }

  if (document.documentMode) {
    window.addEventListener("load", function () {
      var hint = document.getElementById("loginHint");
      var button = document.getElementById("sendCode");
      var message = "当前为 Internet Explorer，无法连接云端短信服务。请使用 Microsoft Edge、Chrome，或将360浏览器切换到极速模式。";
      if (hint) {
        hint.className = "login-hint is-error";
        hint.innerText = message;
      }
      if (button) {
        button.disabled = false;
        button.onclick = function () {
          alert(message);
          return false;
        };
      }
    });
  }
})();
