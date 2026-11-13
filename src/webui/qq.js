/** QQ 面板：正式版连接、会话与事件视图。 */
const QQ_STYLE_ID = 'cp-qq-style';
const QQ_CSS = `
.cpq{--ink:#26251f;--muted:#7d786c;--line:#e8e1d4;--card:#fffdf8;--teal:#356f67;--danger:#a95745;
  color:var(--ink);font:13px/1.55 "Microsoft YaHei","PingFang SC",system-ui,sans-serif;
  background:linear-gradient(180deg,#faf7ef 0%,#f3eee3 100%);border-radius:18px;padding:18px 20px 24px;min-height:100%}
.cpq *{box-sizing:border-box}
.cpq-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding-bottom:14px;border-bottom:1px solid var(--line)}
.cpq-avatar{width:42px;height:42px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(145deg,#6b9bc6,#3d6c97);color:#fff;font-size:18px;font-weight:600;box-shadow:0 5px 14px #3d6c9730}
.cpq-brand{min-width:0}.cpq-title{margin:0;font-size:18px;font-weight:650;letter-spacing:.2px}.cpq-sub{margin-top:2px;color:var(--muted);font-size:11px}
.cpq-grow{flex:1}.cpq-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:#fffdf8;border-radius:999px;padding:4px 10px;font-size:11px;color:var(--muted)}
.cpq-dot{width:7px;height:7px;border-radius:50%;background:#a9a190}.cpq-dot.on{background:#4f9478}.cpq-dot.wait{background:#c6a04a}.cpq-dot.bad{background:#b0604d}
.cpq-actions{display:flex;gap:7px;flex-wrap:wrap}.cpq-btn{border:1px solid var(--line);background:#fffdf8;color:var(--ink);border-radius:8px;padding:5px 11px;font-size:11px;cursor:pointer;transition:.15s}
.cpq-btn:hover{border-color:#cfc4b2}.cpq-btn.primary{background:var(--teal);border-color:var(--teal);color:#fff}.cpq-btn.danger{color:var(--danger);border-color:#e8cbc4}.cpq-btn:disabled{opacity:.5;cursor:default}
.cpq-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px}
.cpq-stat{background:rgba(255,253,248,.7);border:1px solid var(--line);border-radius:11px;padding:9px 11px}
.cpq-stat span{display:block;font-size:10px;color:var(--muted);letter-spacing:.4px}.cpq-stat b{display:block;margin-top:3px;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cpq-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(290px,.75fr);gap:12px;margin-top:12px;align-items:start}
.cpq-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;box-shadow:0 8px 22px #2c2a2508}
.cpq-card.wide{grid-column:1/-1}.cpq-lbl{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;color:var(--muted);letter-spacing:.4px;margin-bottom:9px}
.cpq-lbl b{font-weight:600;color:var(--ink);font-size:12px;letter-spacing:0}
.cpq-list{display:flex;flex-direction:column;gap:7px;max-height:290px;overflow:auto}
.cpq-item{background:#faf7ef;border:1px solid #eee7da;border-radius:9px;padding:7px 9px;font-size:11px;color:#575247;line-height:1.55}
.cpq-item time{display:block;color:#a39b8b;font-size:9px;margin-bottom:2px}
.cpq-item .cpq-kind{display:inline-block;margin-right:5px;font-size:9px;color:#5b7f78;background:#e3efeb;border-radius:4px;padding:1px 5px}
.cpq-empty{color:var(--muted);font-size:11px;padding:8px 2px}
.cpq-more{border:none;background:none;color:var(--teal);font-size:10px;cursor:pointer;padding:0}
.cpq-settings{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:2px}
.cpq-field{font-size:10px;color:var(--muted)}.cpq-field.full{grid-column:1/-1}
.cpq-input{width:100%;border:1px solid var(--line);background:#faf7ef;border-radius:8px;padding:6px 8px;font-size:11px;color:var(--ink);margin-top:4px}
.cpq-input:focus{outline:none;border-color:#9bb8b1;box-shadow:0 0 0 2px #427f7715}
.cpq-save{margin-top:10px}.cpq-hint{font-size:10px;color:var(--muted);line-height:1.6;margin-top:7px}
.cpq-msg{display:none;margin-top:9px;padding:6px 8px;border-radius:8px;font-size:10.5px;background:#e2efea;color:#2f625b}.cpq-msg.bad{background:#f7e3dd;color:#8f4637}.cpq-msg.on{display:block}
.cpq-group-form{display:grid;grid-template-columns:1fr 1fr;gap:7px}.cpq-group-form .full{grid-column:1/-1}
.cpq-select{width:100%;border:1px solid var(--line);background:#faf7ef;border-radius:8px;padding:6px 8px;font-size:11px;margin-top:4px;color:var(--ink)}
.cpq-result{margin-top:8px;font-size:10.5px;color:var(--teal);white-space:pre-wrap;word-break:break-all}
.cpq details{border-top:1px solid var(--line);margin-top:12px;padding-top:10px}.cpq summary{cursor:pointer;font-size:11px;color:var(--muted);list-style:none}.cpq summary::-webkit-details-marker{display:none}.cpq summary::before{content:'▸';display:inline-block;margin-right:5px;color:#a39b8b;transition:.15s}.cpq details[open] summary::before{transform:rotate(90deg)}
@media(max-width:900px){.cpq-grid{grid-template-columns:1fr}.cpq-stats{grid-template-columns:1fr 1fr}.cpq-settings,.cpq-group-form{grid-template-columns:1fr}}
`;

export default {
  panels: {
    qq: {
      mount: async (ctx) => {
        const { root } = ctx;
        const doc = root.ownerDocument;
        let style = doc.getElementById(QQ_STYLE_ID);
        if (!style) {
          style = doc.createElement('style');
          style.id = QQ_STYLE_ID;
          doc.head.appendChild(style);
        }
        style.textContent = QQ_CSS;
        const el = (tag, cls, text) => {
          const node = doc.createElement(tag);
          if (cls) node.className = cls;
          if (text !== undefined) node.textContent = text;
          return node;
        };
        const app = el('div', 'cpq');
        const head = el('div', 'cpq-head');
        head.append(
          el('div', 'cpq-avatar', 'Q'),
          (() => { const b = el('div', 'cpq-brand'); b.append(el('h1', 'cpq-title', 'QQ'), el('div', 'cpq-sub', '原生 OneBot 通道')); return b; })(),
          el('div', 'cpq-grow'),
        );
        const chip = el('span', 'cpq-chip');
        const dot = el('span', 'cpq-dot');
        const chipText = el('span', '', '读取中');
        chip.append(dot, chipText);
        const actions = el('div', 'cpq-actions');
        const connectBtn = el('button', 'cpq-btn primary', '连接');
        const disconnectBtn = el('button', 'cpq-btn danger', '断开');
        const refreshBtn = el('button', 'cpq-btn', '刷新');
        for (const b of [connectBtn, disconnectBtn, refreshBtn]) b.type = 'button';
        actions.append(connectBtn, disconnectBtn, refreshBtn);
        head.append(chip, actions);
        app.append(head);

        const stats = el('div', 'cpq-stats');
        const accountValue = el('b', '', '—');
        const eventValue = el('b', '', '0');
        const lastValue = el('b', '', '—');
        for (const [label, value] of [['当前账号', accountValue], ['收到事件', eventValue], ['最近活动', lastValue]]) {
          const item = el('div', 'cpq-stat'); item.append(el('span', '', label), value); stats.append(item);
        }
        app.append(stats);

        const grid = el('div', 'cpq-grid');
        const messagesCard = el('div', 'cpq-card wide');
        const messagesLbl = el('div', 'cpq-lbl');
        messagesLbl.append(el('b', '', '最近消息'), el('span', '', '私聊 / 群聊'));
        const messagesBox = el('div', 'cpq-list');
        messagesCard.append(messagesLbl, messagesBox);

        const eventsCard = el('div', 'cpq-card');
        const eventsLbl = el('div', 'cpq-lbl');
        eventsLbl.append(el('b', '', '事件'), el('span', '', '实时'));
        const eventsBox = el('div', 'cpq-list');
        const historyBox = el('div', 'cpq-list');
        historyBox.style.display = 'none';
        historyBox.style.marginTop = '8px';
        const historyBtn = el('button', 'cpq-more', '查看全部');
        historyBtn.type = 'button';
        eventsCard.append(eventsLbl, eventsBox, historyBox, historyBtn);

        const settingsCard = el('div', 'cpq-card');
        const settingsLbl = el('div', 'cpq-lbl');
        settingsLbl.append(el('b', '', '连接设置'), el('span', '', '高级'));
        const settings = el('div', 'cpq-settings');
        const urlField = el('div', 'cpq-field full');
        const urlInput = el('input', 'cpq-input');
        urlInput.placeholder = 'ws://127.0.0.1:3001';
        urlField.append(el('span', '', 'WebSocket 地址'), urlInput);
        const tokenField = el('div', 'cpq-field full');
        const tokenInput = el('input', 'cpq-input');
        tokenInput.type = 'password'; tokenInput.placeholder = '留空保持不变';
        tokenField.append(el('span', '', 'Token'), tokenInput);
        const receiveField = el('div', 'cpq-field full');
        const receiveInput = el('input', 'cpq-input');
        receiveInput.placeholder = 'private:* / group:123456 / *';
        receiveField.append(el('span', '', '接收会话'), receiveInput);
        const sttField = el('div', 'cpq-field full');
        const sttInput = el('input', 'cpq-input');
        sttInput.placeholder = '留空使用 DeepSeek ASR';
        sttField.append(el('span', '', '外部转写命令'), sttInput);
        settings.append(urlField, tokenField, receiveField, sttField);
        const saveBtn = el('button', 'cpq-btn primary cpq-save', '保存设置');
        saveBtn.type = 'button';
        const msg = el('div', 'cpq-msg');
        settingsCard.append(settingsLbl, settings, saveBtn, msg);

        const groupCard = el('div', 'cpq-card');
        const groupLbl = el('div', 'cpq-lbl');
        groupLbl.append(el('b', '', '群管理'), el('span', '', '需要确认'));
        const groupForm = el('div', 'cpq-group-form');
        const groupId = el('input', 'cpq-input'); groupId.placeholder = '群号';
        const groupAction = el('select', 'cpq-select');
        for (const [value, label] of [['set_group_ban', '禁言成员'], ['set_group_kick', '移出成员'], ['set_group_card', '修改群名片'], ['set_group_whole_ban', '全员禁言'], ['set_group_name', '修改群名']]) {
          const option = doc.createElement('option'); option.value = value; option.textContent = label; groupAction.append(option);
        }
        const groupParams = el('input', 'cpq-input full'); groupParams.placeholder = '参数 JSON，例如 {"user_id":123,"duration":600}';
        groupForm.append(groupId, groupAction, groupParams);
        const groupBtn = el('button', 'cpq-btn primary cpq-save', '执行');
        groupBtn.type = 'button';
        const groupResult = el('div', 'cpq-result');
        groupCard.append(groupLbl, groupForm, groupBtn, groupResult);

        grid.append(messagesCard, eventsCard, settingsCard, groupCard);
        app.append(grid);
        root.append(app);

        let snapshot = null;
        let busy = false;
        let showHistory = false;
        const showMsg = (text, bad = false) => { msg.textContent = text; msg.classList.toggle('bad', bad); msg.classList.toggle('on', Boolean(text)); };
        const fmtTime = (iso) => {
          if (!iso) return '—';
          const d = new Date(iso);
          return Number.isFinite(d.getTime()) ? d.toLocaleString('zh-CN', { hour12: false }).slice(5) : '—';
        };
        const stateInfo = (state) => {
          if (state === 'online') return ['已连接', 'on'];
          if (state === 'connecting') return ['连接中', 'wait'];
          if (state === 'error') return ['连接异常', 'bad'];
          if (state === 'disabled') return ['未启用', ''];
          return ['未连接', ''];
        };
        const listItem = (time, label, text) => {
          const row = el('div', 'cpq-item');
          row.append(el('time', '', `${fmtTime(time)}${label ? ` · ${label}` : ''}`), doc.createTextNode(text));
          return row;
        };
        const render = () => {
          if (!snapshot) return;
          const status = snapshot.status || {};
          const [label, tone] = stateInfo(status.state);
          chipText.textContent = label;
          dot.className = `cpq-dot ${tone}`;
          accountValue.textContent = status.selfId || '未登录';
          eventValue.textContent = String(status.eventCount ?? 0);
          lastValue.textContent = fmtTime(status.lastEventAt);
          messagesBox.replaceChildren();
          const messages = snapshot.messages || [];
          if (!messages.length) messagesBox.append(el('div', 'cpq-empty', '还没有收到 QQ 消息。'));
          for (const m of messages) {
            const kind = m.messageType === 'group' ? '群聊' : '私聊';
            const media = [m.imageFiles?.length ? `图 ×${m.imageFiles.length}` : '', m.voicePaths?.length ? '语音' : '', m.filePaths?.length ? '文件' : ''].filter(Boolean).join(' · ');
            messagesBox.append(listItem(m.at, kind, `${m.nickname}：${m.text || m.voiceText || '[媒体消息]'}${media ? `（${media}）` : ''}`));
          }
          eventsBox.replaceChildren();
          const recent = snapshot.recent || [];
          if (!recent.length) eventsBox.append(el('div', 'cpq-empty', '暂无事件。'));
          for (const e of recent) {
            const row = el('div', 'cpq-item'); row.append(el('time', '', fmtTime(e.at)), doc.createTextNode(e.detail));
            eventsBox.append(row);
          }
          historyBox.replaceChildren();
          const history = snapshot.eventHistory || [];
          for (const e of history) historyBox.append(listItem(e.at, e.type, e.detail));
          historyBtn.textContent = showHistory ? '收起' : `查看全部（${history.length}）`;
          historyBox.style.display = showHistory ? 'flex' : 'none';
          if (doc.activeElement !== urlInput) urlInput.value = snapshot.config?.wsUrl || status.wsUrl || '';
          if (doc.activeElement !== receiveInput) receiveInput.value = snapshot.config?.receive || 'private:*';
          if (doc.activeElement !== sttInput) sttInput.value = snapshot.config?.sttCommand || '';
          connectBtn.disabled = busy; disconnectBtn.disabled = busy; saveBtn.disabled = busy;
          if (status.lastError) showMsg(status.lastError, true);
        };
        const load = async () => {
          try { snapshot = await ctx.invoke('status'); render(); }
          catch (error) { showMsg(`读取失败：${error instanceof Error ? error.message : String(error)}`, true); }
        };
        const run = async (method, args = []) => {
          if (busy) return;
          busy = true; showMsg(''); render();
          try { snapshot = await ctx.invoke(method, args); render(); showMsg(snapshot.result ? String(snapshot.result) : '已更新'); }
          catch (error) { showMsg(`操作失败：${error instanceof Error ? error.message : String(error)}`, true); }
          finally { busy = false; render(); }
        };
        historyBtn.addEventListener('click', () => { showHistory = !showHistory; render(); });
        connectBtn.addEventListener('click', () => void run('connect'));
        disconnectBtn.addEventListener('click', () => void run('disconnect'));
        refreshBtn.addEventListener('click', () => void load());
        saveBtn.addEventListener('click', () => {
          const patch = { wsUrl: urlInput.value.trim(), receive: receiveInput.value.trim(), sttCommand: sttInput.value.trim(), enabled: snapshot?.status?.enabled === true };
          if (tokenInput.value.trim()) patch.token = tokenInput.value.trim();
          void run('save', [patch]);
        });
        groupBtn.addEventListener('click', () => {
          if (/^(set_group_kick|set_group_ban|set_group_whole_ban)$/.test(groupAction.value)
            && !doc.defaultView?.confirm(`确认执行 ${groupAction.value}？`)) return;
          let params = {};
          if (groupParams.value.trim()) {
            try { params = JSON.parse(groupParams.value); } catch { showMsg('参数不是合法 JSON', true); return; }
          }
          void run('group', [{ action: groupAction.value, group_id: groupId.value.trim(), params }]);
        });
        await load();
        ctx.interval(() => { if (!busy) void load(); }, 10_000);
      },
    },
  },
};
