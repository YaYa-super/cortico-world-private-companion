/** B站面板：浏览、消息、一起看与账号。 */
const BILI_STYLE_ID = 'cp-bili-style';
const BILI_CSS = `
.cpb{--ink:#26251f;--muted:#7d786c;--line:#e8e1d4;--card:#fffdf8;--pink:#b15b74;--teal:#356f67;
  color:var(--ink);font:13px/1.55 "Microsoft YaHei","PingFang SC",system-ui,sans-serif;
  background:linear-gradient(180deg,#faf7ef 0%,#f3eee3 100%);border-radius:18px;padding:18px 20px 24px;min-height:100%}
.cpb *{box-sizing:border-box}
.cpb-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding-bottom:13px;border-bottom:1px solid var(--line)}
.cpb-avatar{width:42px;height:42px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(145deg,#e28ba1,#a95370);color:#fff;font-size:18px;font-weight:600;box-shadow:0 5px 14px #a9537030}
.cpb-title{margin:0;font-size:18px;font-weight:650}.cpb-sub{color:var(--muted);font-size:11px;margin-top:2px}
.cpb-grow{flex:1}.cpb-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:#fffdf8;border-radius:999px;padding:4px 10px;font-size:11px;color:var(--muted)}
.cpb-chip b{font-weight:600;color:var(--ink)}.cpb-dot{width:7px;height:7px;border-radius:50%;background:#c6a04a}.cpb-dot.on{background:#4f9478}.cpb-dot.bad{background:#b0604d}
.cpb-tabs{display:flex;gap:4px;margin:13px 0 12px;padding:3px;background:#f0eadf;border-radius:10px;width:max-content;max-width:100%;overflow:auto}
.cpb-tab{border:none;background:transparent;border-radius:8px;padding:6px 14px;font-size:11.5px;color:#716b5f;cursor:pointer;white-space:nowrap}
.cpb-tab.on{background:#fffdf8;color:var(--ink);box-shadow:0 2px 8px #2c2a2512;font-weight:600}
.cpb-panel{display:none}.cpb-panel.on{display:block}
.cpb-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;box-shadow:0 8px 22px #2c2a2508}
.cpb-lbl{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;color:var(--muted);margin-bottom:9px}.cpb-lbl b{font-size:12px;color:var(--ink);font-weight:600}
.cpb-search{display:flex;gap:7px;flex-wrap:wrap}.cpb-input{flex:1;min-width:180px;border:1px solid var(--line);background:#faf7ef;border-radius:8px;padding:6px 9px;font-size:11px;color:var(--ink)}
.cpb-input:focus{outline:none;border-color:#c7a6b1;box-shadow:0 0 0 2px #b15b7415}
.cpb-btn{border:1px solid var(--line);background:#fffdf8;color:var(--ink);border-radius:8px;padding:5px 11px;font-size:11px;cursor:pointer}.cpb-btn:hover{border-color:#d4c8bb}
.cpb-btn.primary{background:var(--pink);border-color:var(--pink);color:#fff}.cpb-btn:disabled{opacity:.5;cursor:default}
.cpb-results{display:flex;flex-direction:column;gap:6px;margin-top:9px;max-height:230px;overflow:auto}
.cpb-result{display:flex;flex-direction:column;gap:1px;background:#faf7ef;border:1px solid #eee7da;border-radius:9px;padding:7px 9px;font-size:11px;cursor:pointer}.cpb-result:hover{border-color:#d8b9c4}
.cpb-result b{font-weight:600;line-height:1.4}.cpb-result span{color:var(--muted);font-size:9.5px}
.cpb-msg2{font-size:10.5px;color:var(--muted);margin-top:7px;white-space:pre-line}
.cpb-detail2{margin-top:9px;border-top:1px solid var(--line);padding-top:9px;font-size:11px;line-height:1.65}.cpb-detail2 b{font-size:12.5px}.cpb-detail2 p{margin:4px 0;white-space:pre-wrap;color:#5d584d}.cpb-detail2 .cpb-actions{margin-top:7px}
.cpb-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(290px,.8fr);gap:12px;align-items:start}
.cpb-col{display:flex;flex-direction:column;gap:12px}
.cpb-note{color:var(--muted);font-size:10.5px;line-height:1.65;margin-top:7px;white-space:pre-wrap;word-break:break-word}
.cpb-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.cpb-form{display:flex;flex-direction:column;gap:7px}
.cpb-form .cpb-input{width:100%}.cpb-check{display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--muted)}
.cpb-notice-list{display:flex;flex-direction:column;gap:6px;max-height:230px;overflow:auto;margin-top:8px}
.cpb-notice{display:flex;justify-content:space-between;gap:8px;align-items:center;background:#faf7ef;border:1px solid #eee7da;border-radius:9px;padding:7px 9px;font-size:10.5px}
.cpb-notice span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cpb-notice .cpb-btn{padding:3px 8px;font-size:10px}
.cpb-status{font-size:10.5px;color:var(--muted);margin-top:8px;line-height:1.65;white-space:pre-wrap;word-break:break-word}
.cpb-empty{color:var(--muted);font-size:10.5px;padding:6px 0}
.cpb-msg{display:none;margin-top:8px;padding:6px 8px;border-radius:8px;font-size:10.5px;background:#e2efea;color:#2f625b}.cpb-msg.bad{background:#f7e3dd;color:#8f4637}.cpb-msg.on{display:block}
.cpb-account{display:flex;gap:11px;align-items:center}.cpb-face{width:52px;height:52px;border-radius:50%;object-fit:cover;background:#eee6da;border:1px solid var(--line)}
.cpb-account b{display:block;font-size:14px}.cpb-account span{display:block;color:var(--muted);font-size:10.5px;margin-top:2px}
@media(max-width:900px){.cpb-grid{grid-template-columns:1fr}.cpb-search{flex-direction:column}.cpb-search .cpb-input{min-width:0}}
`;

export default {
  panels: {
    bili: {
      mount: async (ctx) => {
        const { root } = ctx;
        const doc = root.ownerDocument;
        let style = doc.getElementById(BILI_STYLE_ID);
        if (!style) { style = doc.createElement('style'); style.id = BILI_STYLE_ID; doc.head.appendChild(style); }
        style.textContent = BILI_CSS;
        const el = (tag, cls, text) => { const node = doc.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
        const app = el('div', 'cpb');
        const head = el('div', 'cpb-head');
        head.append(el('div', 'cpb-avatar', 'B'));
        const brand = el('div'); brand.append(el('h1', 'cpb-title', 'B站'), el('div', 'cpb-sub', '视频与一起看')); head.append(brand, el('div', 'cpb-grow'));
        const chip = el('span', 'cpb-chip'); const chipDot = el('span', 'cpb-dot'); const chipText = el('b', '', '读取中'); chip.append(chipDot, chipText);
        const togetherBtn = el('button', 'cpb-btn primary', '一起看'); togetherBtn.type = 'button'; head.append(chip, togetherBtn);
        app.append(head);
        const browse = el('div', 'cpb-panel on');
        app.append(browse);
        root.append(app);

        // 浏览
        const searchCard = el('div', 'cpb-card');
        const searchLbl = el('div', 'cpb-lbl'); searchLbl.append(el('b', '', '搜索与视频'), el('span', '', '公开内容'));
        const searchRow = el('div', 'cpb-search');
        const searchInput = el('input', 'cpb-input'); searchInput.placeholder = '搜索视频，或输入 BV 号';
        const searchBtn = el('button', 'cpb-btn primary', '搜索'); const historyBtn = el('button', 'cpb-btn', '观看记录');
        searchBtn.type = 'button'; historyBtn.type = 'button'; searchRow.append(searchInput, searchBtn, historyBtn);
        const searchMsg = el('div', 'cpb-msg2');
        const results = el('div', 'cpb-results'); const detail = el('div', 'cpb-detail2');
        searchCard.append(searchLbl, searchRow, searchMsg, results, detail);
        browse.append(searchCard);

        const setBusy = (busy) => { searchBtn.disabled = busy; };
        const showHistory = async () => {
          searchMsg.textContent = '读取观看记录…';
          try {
            const result = await ctx.invoke('history', [20]); const rows = result.history || [];
            detail.replaceChildren(el('b', '', '观看记录'));
            if (!rows.length) detail.append(el('p', '', '没有读取到观看记录。'));
            for (const row of rows) detail.append(el('p', '', `${row.title}（${row.bvid}）· ${row.author}`));
            searchMsg.textContent = rows.length ? `最近 ${rows.length} 条` : '';
          } catch (error) { searchMsg.textContent = `读取失败：${error instanceof Error ? error.message : String(error)}`; }
        };
        const showDanmaku = async (bvid) => {
          try {
            const result = await ctx.invoke('danmaku', [bvid, 80]); const rows = result.danmaku || [];
            detail.replaceChildren(el('b', '', '弹幕'));
            if (!rows.length) detail.append(el('p', '', '没有读到弹幕。'));
            for (const row of rows.slice(0, 80)) detail.append(el('p', '', `[${Math.floor(row.time)}s] ${row.text}`));
          } catch (error) { searchMsg.textContent = `读取失败：${error instanceof Error ? error.message : String(error)}`; }
        };
        const showComments = async (bvid) => {
          try {
            const result = await ctx.invoke('comments', [bvid, 10]); const rows = result.comments || [];
            detail.replaceChildren(el('b', '', '热评'));
            if (!rows.length) detail.append(el('p', '', '没有读到评论。'));
            for (const row of rows) detail.append(el('p', '', `${row.user}（rpid=${row.rpid}，${row.like} 赞）：${row.message}`));
          } catch (error) { searchMsg.textContent = `读取失败：${error instanceof Error ? error.message : String(error)}`; }
        };
        const showSubtitles = async (bvid) => {
          try {
            const result = await ctx.invoke('subtitles', [bvid]); const rows = result.subtitles || [];
            detail.replaceChildren(el('b', '', '字幕'));
            if (!rows.length) detail.append(el('p', '', '没有读到字幕。'));
            for (const row of rows.slice(0, 200)) detail.append(el('p', '', `[${Math.floor(row.from)}s] ${row.text}`));
          } catch (error) { searchMsg.textContent = `读取失败：${error instanceof Error ? error.message : String(error)}`; }
        };
        const showInfo = async (bvid) => {
          try {
            const result = await ctx.invoke('info', [bvid]); const info = result.info || {};
            detail.replaceChildren();
            detail.append(el('b', '', info.title || bvid));
            detail.append(el('p', '', `${info.owner || '未知 UP'} · ${Math.floor(Number(info.duration) || 0)} 秒 · ${info.play ? `${info.play} 播放` : ''}`));
            if (info.desc) detail.append(el('p', '', String(info.desc).slice(0, 220)));
            const acts = el('div', 'cpb-actions');
            for (const [label, fn] of [['热评', () => void showComments(bvid)], ['弹幕', () => void showDanmaku(bvid)], ['字幕', () => void showSubtitles(bvid)]]) {
              const b = el('button', 'cpb-btn', label); b.type = 'button'; b.addEventListener('click', fn); acts.append(b);
            }
            detail.append(acts);
          } catch (error) { searchMsg.textContent = `读取失败：${error instanceof Error ? error.message : String(error)}`; }
        };
        const search = async () => {
          const query = searchInput.value.trim(); if (!query) return;
          setBusy(true); results.replaceChildren(); detail.replaceChildren(); searchMsg.textContent = '读取中…';
          try {
            if (/^BV[0-9A-Za-z]+$/.test(query)) { await showInfo(query); searchMsg.textContent = ''; }
            else {
              const data = await ctx.invoke('search', [query, 8]); const hits = data.hits || [];
              searchMsg.textContent = hits.length ? `找到 ${hits.length} 条` : '没有找到。';
              for (const hit of hits) {
                const row = el('div', 'cpb-result'); row.append(el('b', '', hit.title || hit.bvid), el('span', '', `${hit.author || ''} · ${hit.bvid} · ${hit.duration || 0} 秒`));
                row.addEventListener('click', () => void showInfo(hit.bvid)); results.append(row);
              }
            }
          } catch (error) { searchMsg.textContent = `读取失败：${error instanceof Error ? error.message : String(error)}`; }
          finally { setBusy(false); }
        };
        searchBtn.addEventListener('click', () => void search());
        searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') void search(); });
        historyBtn.addEventListener('click', () => void showHistory());

        togetherBtn.addEventListener('click', async () => {
          if (togetherBtn.disabled) return;
          togetherBtn.disabled = true;
          searchMsg.textContent = '正在一起看…';
          try {
            const result = await ctx.invoke('together_auto', []);
            const status = result?.together || result || {};
            searchMsg.textContent = status.title ? `一起看：${status.title}` : '一起看已启动';
          } catch (error) {
            searchMsg.textContent = `一起看失败：${error instanceof Error ? error.message : String(error)}`;
          } finally { togetherBtn.disabled = false; }
        });

        const loadStatus = async () => {
          try {
            const result = await ctx.invoke('status', []); const nav = result.nav || {};
            chipText.textContent = nav.loggedIn ? nav.name || '已登录' : '未登录';
            chipDot.className = `cpb-dot ${nav.loggedIn ? 'on' : ''}`;
          } catch { chipText.textContent = '读取失败'; chipDot.className = 'cpb-dot bad'; }
        };

        await loadStatus();
      },
    },
  },
};
