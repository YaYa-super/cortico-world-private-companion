/**
 * 「她的一天」可视化面板（只读）：此刻 / 记忆星图 / 心理活动 / 关系。
 *
 * 纯 DOM + 2D canvas 伪 3D，不引外部库；数据来自 world.ts 的 dashboard / constellation。
 * 与旧的「记忆」面板并存：旧面板继续做精确列表与撤销合并，这里负责观察。
 */

const STYLE_ID = 'cp-life-style';
const CSS = `
.cp-app{--paper:#f4efe4;--card:#fffdf8;--ink:#2c2a25;--muted:#8a8478;--line:#e7dfd0;
  --teal:#427f77;--teal-soft:#dcebe7;--gold:#c89a4b;--gold-soft:#f3e7cc;--coral:#c46e59;
  --coral-soft:#f6e0da;--blue:#6f8fb0;--blue-soft:#e2eaf3;--violet:#8d7aa8;
  color:var(--ink);font:13px/1.55 "Microsoft YaHei","PingFang SC","Noto Sans SC",system-ui,sans-serif;
  background:radial-gradient(1100px 460px at 10% -10%,#fffaf0 0%,rgba(255,250,240,0) 60%),var(--paper);
  border-radius:16px;padding:18px 20px 24px;box-sizing:border-box}
.cp-app *{box-sizing:border-box}
.cp-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.cp-brand{display:flex;align-items:center;gap:10px}
.cp-avatar{width:38px;height:38px;border-radius:13px;display:grid;place-items:center;font-size:20px;
  background:linear-gradient(145deg,#7fa9c9,#4e7f9f);color:#fff;box-shadow:0 6px 16px #427f7730}
.cp-name-input{font-size:17px;font-weight:700;margin:0;letter-spacing:.5px;color:var(--ink);background:transparent;border:1px solid transparent;border-radius:6px;padding:1px 4px;max-width:180px;font-family:inherit}
.cp-name-input:hover{border-color:#e7dfd0}.cp-name-input:focus{outline:none;border-color:#c89a4b;background:#fffdf8}
.cp-brand small{display:block;color:var(--muted);font-size:10.5px;letter-spacing:1.2px}
.cp-status{display:flex;align-items:center;gap:6px;background:var(--card);border:1px solid var(--line);
  border-radius:999px;padding:5px 11px;color:var(--muted);font-size:11.5px}
.cp-dot{width:7px;height:7px;border-radius:50%;background:#6aa78b;box-shadow:0 0 0 3px #6aa78b22}
.cp-grow{flex:1}
.cp-tabs{display:flex;gap:5px;background:#fffdf8aa;border:1px solid var(--line);padding:4px;border-radius:12px}
.cp-tab{padding:5px 12px;border-radius:9px;color:var(--muted);font-size:12px;cursor:pointer;border:0;background:none}
.cp-tab.on{background:var(--ink);color:#fff8ec}
.cp-view{margin-top:14px}
.cp-grid{display:grid;grid-template-columns:300px minmax(0,1fr) 330px;gap:13px}
.cp-card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:13px 14px;
  box-shadow:0 7px 22px #2c2a2507;position:relative;overflow:hidden}
.cp-lbl{font-size:10px;letter-spacing:1.3px;color:var(--muted);margin-bottom:6px}
.cp-now-grid{grid-template-columns:minmax(280px,.95fr) minmax(300px,1.35fr) minmax(320px,1fr)}
.cp-now-hero{grid-column:1}.cp-now-dec{grid-column:3}
.cp-now-side{display:flex;flex-direction:column;gap:13px;min-width:0}
.cp-daywide{margin-top:13px}
.cp-feed{grid-column:auto;margin-top:13px}
.cp-feed .cp-feedlist{grid-template-columns:1fr}
.cp-mini{grid-column:1/3;margin-top:13px}.cp-side{grid-column:3;margin-top:13px}
.cp-row{display:flex;align-items:center;gap:9px}
.cp-name{font-size:15px;font-weight:700;margin:0}
.cp-sub{color:var(--muted);font-size:11px}
.cp-pill{display:inline-flex;align-items:center;border-radius:999px;padding:2px 8px;font-size:10.5px;background:var(--teal-soft);color:#2f625b}
.cp-pill.gold{background:var(--gold-soft);color:#8a6421}
.cp-ring{width:68px;height:68px;border-radius:50%;position:relative;flex:none;background:conic-gradient(var(--teal) 0 71%,#eee7d8 71% 100%)}
.cp-ring:before{content:"";position:absolute;inset:7px;background:var(--card);border-radius:50%}
.cp-ring span{position:absolute;inset:0;display:grid;place-items:center;font-size:15px;font-weight:700}
.cp-stats{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:10px}
.cp-stat{background:#faf5ea;border:1px solid #efe7d7;border-radius:10px;padding:6px 8px}
.cp-stat b{display:block;font-size:12.5px;margin-top:1px}
.cp-stat span{font-size:9.5px;color:var(--muted)}
.cp-daybar{position:relative;height:168px;margin-top:14px;border-top:1px dashed var(--line)}
.cp-hour{position:absolute;top:-5px;font-size:9px;color:#b3aa98;transform:translateX(-50%)}
.cp-slot{position:absolute;height:28px;border-radius:8px;padding:5px 7px;font-size:10.5px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:var(--blue-soft);color:#3f5e7d}
.cp-slot b{font-weight:700}
.cp-nowline{position:absolute;top:-8px;bottom:0;width:1.5px;background:var(--coral)}
.cp-nowline:after{content:"现在";position:absolute;top:-13px;left:4px;color:var(--coral);font-size:8.5px;white-space:nowrap}
.cp-mark{position:absolute;width:9px;height:9px;border-radius:50%;border:2px solid var(--card);box-shadow:0 0 0 1px #00000018}
.cp-mlbl{display:none}
.cp-mlabel{position:absolute;display:inline-flex;align-items:center;gap:4px;background:#fffdf8;border:1px solid #e7dfd0;border-radius:999px;padding:1px 6px;font-size:9px;color:#5f5a4f;white-space:nowrap;transform:translateX(-50%);box-shadow:0 2px 6px #2c2a250d;z-index:2}
.cp-mlabel i{width:6px;height:6px;border-radius:50%;flex:none}
.cp-legend{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
.cp-legend span{display:inline-flex;align-items:center;gap:5px;background:#faf5ea;border:1px solid #efe7d7;border-radius:999px;padding:3px 8px;color:#6e685c;font-size:10.5px}
.cp-legend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin:0}
.cp-decscore{font-size:27px;font-weight:700;letter-spacing:-1px;color:var(--coral)}
.cp-decscore small{font-size:10px;font-weight:400;color:var(--muted);letter-spacing:0}
.cp-badge{font-size:9.5px;border-radius:999px;padding:2px 8px;background:var(--coral-soft);color:#8f4637;margin-left:auto}
.cp-badge.ok{background:var(--teal-soft);color:#2f625b}
.cp-rows{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.cp-drow{display:grid;grid-template-columns:60px 1fr 40px;align-items:center;gap:6px;font-size:10.5px;color:#6e685c}
.cp-track{height:6px;background:#f1eadc;border-radius:99px;position:relative;overflow:hidden}
.cp-fill{position:absolute;top:0;bottom:0;border-radius:99px}
.cp-drow b{text-align:right;font-weight:600;color:var(--ink);font-size:10.5px}
.cp-decfoot{margin-top:8px;padding-top:7px;border-top:1px dashed var(--line);font-size:9.5px;color:var(--muted)}
.cp-reltop{display:flex;align-items:baseline;gap:7px}
.cp-big{font-size:22px;font-weight:700;letter-spacing:-.5px}
.cp-relbar{height:6px;border-radius:99px;background:#f0e8d8;margin:6px 0 3px;overflow:hidden}
.cp-relbar i{display:block;height:100%;background:linear-gradient(90deg,var(--gold),var(--coral));border-radius:99px}
.cp-mini3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:8px}
.cp-mini3 div{background:#faf5ea;border-radius:9px;padding:5px 7px;font-size:9px;color:var(--muted)}
.cp-mini3 b{display:block;font-size:12px;color:var(--ink)}
.cp-model{display:flex;flex-direction:column;gap:6px;margin-top:6px}
.cp-mrow{display:flex;gap:6px;align-items:flex-start;font-size:10.5px;line-height:1.45}
.cp-mtag{flex:none;font-size:8.5px;border-radius:4px;padding:1px 4px;margin-top:1px;background:var(--teal-soft);color:#2f625b}
.cp-mtag.h{background:var(--gold-soft);color:#8a6421}
.cp-conf{margin-left:auto;flex:none;font-size:8.5px;color:#a99f8d}
.cp-feedlist{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:5px}
.cp-ev{background:#faf5ea;border:1px solid #efe7d7;border-radius:10px;padding:7px 8px;font-size:10.5px;color:#5f5a4f}
.cp-ev time{font-size:8.5px;color:#a99f8d;margin-right:4px}
.cp-ev b{color:var(--ink)}
.cp-ev .tag{font-size:8px;background:#fffdf8;border:1px solid var(--line);border-radius:4px;padding:0 3px;margin-right:3px;color:var(--muted)}
.cp-empty{color:var(--muted);font-size:11px;padding:14px 4px;text-align:center}
.cp-err{color:#a4442f;font-size:11px;padding:8px 0}
/* memory */
.cp-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.cp-input{background:#faf5ea;border:1px solid #eee5d4;border-radius:8px;padding:5px 9px;font-size:11px;color:var(--ink);min-width:180px}
.cp-chip{border:1px solid var(--line);border-radius:999px;padding:3px 9px;font-size:10px;color:var(--muted);background:var(--card);cursor:pointer}
.cp-chip.on{background:var(--ink);color:#fff8ec;border-color:var(--ink)}
.cp-mem{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:12px}
.cp-stage{position:relative;background:#0f1726;border-radius:16px;overflow:hidden;height:520px;min-height:360px;border:1px solid #1e2c46}
.cp-stage canvas{display:block;position:absolute;inset:0;width:100%;height:100%}
.cp-stage .hint{position:absolute;left:12px;bottom:10px;color:#8ea3c4;font-size:9.5px;letter-spacing:.3px}
.cp-legend-float{position:absolute;right:10px;bottom:9px;display:flex;gap:8px;color:#9eb2d0;font-size:9px;background:#0b1220aa;padding:4px 7px;border-radius:6px}
.cp-legend-float i{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:3px}
.cp-fsbtn{position:absolute;top:10px;right:10px;z-index:6;border:1px solid #ffffff22;background:#0b1220cc;color:#dbe6f5;border-radius:8px;padding:4px 9px;font-size:10px;cursor:pointer;backdrop-filter:blur(4px)}
.cp-mem.cp-fullscreen{position:fixed;inset:0;z-index:9999;width:100vw;height:100vh;max-width:none;padding:12px;background:#080d17;grid-template-columns:minmax(0,1fr) 340px !important;border-radius:0}
.cp-mem.cp-fullscreen .cp-stage{height:100%;min-height:0;border-radius:10px}
.cp-mem.cp-fullscreen .cp-detail{height:100%;min-height:0;overflow:auto;background:#0d1728;border-color:#22324a;color:#dbe6f5}
.cp-mem.cp-fullscreen .cp-detail h3{color:#f5f0e4}
.cp-mem.cp-fullscreen .cp-detail .meta,.cp-mem.cp-fullscreen .cp-detail .cp-sub{color:#93a8c6}
.cp-mem.cp-fullscreen .cp-detail p{color:#c9d8ec}
.cp-mem.cp-fullscreen .cp-detail .tagline span{background:#16243a;border-color:#2a3b55;color:#a9bdd8}
.cp-mem.cp-fullscreen .cp-fsbtn{display:none}
.cp-fsbar{position:absolute;top:10px;left:10px;z-index:7;display:none;gap:5px;background:#0b1220cc;padding:4px;border-radius:9px;border:1px solid #ffffff18;backdrop-filter:blur(4px)}
.cp-mem.cp-fullscreen .cp-fsbar{display:flex}
.cp-fsbar button{border:1px solid #ffffff1a;background:#111c2ecc;color:#c9d8ec;border-radius:6px;padding:3px 8px;font-size:10px;cursor:pointer}
.cp-fsbar button.on{background:#f0e1bd;color:#1b2433;border-color:#f0e1bd}
.cp-tip{position:absolute;pointer-events:none;background:#fffdf8f2;color:var(--ink);border:1px solid var(--line);
  border-radius:8px;padding:5px 7px;font-size:10px;max-width:220px;display:none;z-index:3;box-shadow:0 6px 18px #0002}
.cp-detail{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;font-size:11px;min-height:520px}
.cp-detail h3{margin:0 0 6px;font-size:12px;line-height:1.4}
.cp-detail .meta{color:var(--muted);font-size:9.5px;margin-bottom:8px}
.cp-detail p{margin:0 0 8px;white-space:pre-wrap;line-height:1.55}
.cp-detail .tagline{display:flex;gap:4px;flex-wrap:wrap;margin:6px 0}
.cp-detail .tagline span{font-size:8.5px;background:#faf5ea;border:1px solid var(--line);border-radius:4px;padding:1px 4px;color:var(--muted)}
.cp-list{margin-top:10px;max-height:360px;overflow:auto;border:1px solid var(--line);border-radius:12px}
.cp-table{width:100%;border-collapse:collapse;font-size:10.5px}
.cp-table th,.cp-table td{text-align:left;padding:6px 8px;border-bottom:1px solid #f0e9db;vertical-align:top}
.cp-table th{color:var(--muted);font-weight:500;background:#faf5ea;position:sticky;top:0}
.cp-table tr{cursor:pointer}.cp-table tr:hover td{background:#faf5ea}
.cp-listview{display:none}
.cp-listview.on{display:block}
.cp-toolstack{display:flex;flex-direction:column;gap:6px;margin-bottom:9px}
.cp-toolstack .cp-toolbar{margin:0;align-items:center}
.cp-toolhint{font-size:9.5px;letter-spacing:1px;color:#b3aa98;margin-right:2px;white-space:nowrap}
.cp-overview{display:none;margin-top:2px}
.cp-overview.on{display:block}
.cp-ovgrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin:2px 0 10px}
.cp-ovstat{background:#faf5ea;border:1px solid #efe7d7;border-radius:10px;padding:7px 8px}
.cp-ovstat span{display:block;font-size:9px;color:var(--muted)}
.cp-ovstat b{font-size:14px}
.cp-recent{display:flex;flex-direction:column;gap:6px}
.cp-recentrow{background:#faf5ea;border:1px solid #efe7d7;border-radius:9px;padding:6px 8px;font-size:10px;color:#5f5a4f}
.cp-recentrow time{font-size:8.5px;color:#a99f8d;margin-right:5px}
.cp-recentrow b{color:var(--ink);font-weight:600}
.cp-searchmeta{font-size:10px;color:var(--muted);padding:2px 2px 6px}
.cp-search-detail:empty{display:none}
.cp-search-detail{margin-top:8px;background:#faf5ea;border:1px solid var(--line);border-radius:12px;padding:10px;font-size:10.5px}
.cp-search-detail h3{margin:0 0 4px;font-size:12px;line-height:1.4}
.cp-search-detail p{margin:5px 0;white-space:pre-wrap;line-height:1.55}
.cp-mergeview{display:none;margin-top:10px}
.cp-mergeview.on{display:block}
.cp-mergewrap{display:flex;flex-direction:column;gap:8px}
.cp-mergecard{background:#faf5ea;border:1px solid var(--line);border-radius:12px;padding:10px 11px;font-size:10.5px}
.cp-mergecard h4{margin:0 0 4px;font-size:11.5px;color:var(--ink)}
.cp-mergecard p{margin:4px 0;line-height:1.5;color:#5f5a4f}
.cp-mergecard .cp-mergeacts{display:flex;gap:6px;align-items:center;margin-top:6px}
.cp-mergecard .cp-mergeacts button{border:1px solid var(--line);background:#fffdf8;border-radius:6px;padding:2px 7px;font-size:9.5px;cursor:pointer;color:#8f4637}
.cp-msg{font-size:10px;padding:5px 8px;border-radius:8px;background:var(--teal-soft);color:#2f625b;margin-bottom:6px}
.cp-msg.bad{background:var(--coral-soft);color:#8f4637}
.cp-stage.hidden,.cp-detail.hidden{display:none}
/* 面板宽度用容器类判断：WebUI 的视口可能很宽，但面板实际只有 700 左右。 */
.cp-app.cp-narrow .cp-grid{grid-template-columns:1fr}
.cp-app.cp-narrow .cp-hero,.cp-app.cp-narrow .cp-day,.cp-app.cp-narrow .cp-dec,
.cp-app.cp-narrow .cp-mini,.cp-app.cp-narrow .cp-side,.cp-app.cp-narrow .cp-feed{grid-column:1}
.cp-app.cp-narrow .cp-now-grid{grid-template-columns:1fr}
.cp-app.cp-narrow .cp-now-dec{grid-column:1}
.cp-app.cp-narrow .cp-mem{grid-template-columns:1fr}
.cp-app.cp-narrow .cp-stage{height:400px}
.cp-app.cp-narrow .cp-detail{min-height:0}
.cp-app.cp-narrow .cp-feedlist{grid-template-columns:1fr}
.cp-app.cp-mid .cp-now-grid{grid-template-columns:1fr 1fr}
.cp-app.cp-mid .cp-now-dec{grid-column:1/3}
.cp-app.cp-mid .cp-dec{grid-column:1/3}
.cp-app.cp-mid .cp-mini,.cp-app.cp-mid .cp-side,.cp-app.cp-mid .cp-feed{grid-column:1/3}
@media(max-width:1250px){
  .cp-grid{grid-template-columns:1fr 1fr}
  .cp-hero{grid-column:1}.cp-day{grid-column:2}.cp-dec{grid-column:1/3}
  .cp-mini,.cp-side,.cp-feed{grid-column:1/3}
}
@media(max-width:900px){
  .cp-app{padding:12px}
  .cp-grid{grid-template-columns:1fr}
  .cp-hero,.cp-day,.cp-dec,.cp-mini,.cp-side,.cp-feed{grid-column:1}
  .cp-now-grid{grid-template-columns:1fr}.cp-now-dec{grid-column:1}
  .cp-mem{grid-template-columns:1fr}
  .cp-stage{height:400px}
  .cp-detail{min-height:0}
  .cp-feedlist{grid-template-columns:1fr}
  .cp-daybar{height:168px}
}
`;

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const COLORS = {
  rule: '#c89a4b', person: '#427f77', self: '#5d9b8f', thread: '#c46e59',
  facts: '#6f8fb0', fact: '#6f8fb0', episode: '#7b93b8',
};
const KIND_LABEL = { rule: '规则', person: '人物', self: '自我', thread: '话头', fact: '事实', episode: '经历' };
const MIND_LABEL = {
  proactive: '主动', gate: '被拦', thought: '念头', trigger: '触发', candidate: '候选',
  review: '复盘', followup: '跟进', intention: '意图', action: '动作', echo: '回声',
  memory: '记忆', silent: '静默', musing: '走神', recap: '回顾',
};

/** 同一次心理活动会同时记 thought 和 candidate；展示时合并成一条，避免看起来像重复。 */
function collapseMind(events) {
  const priority = { candidate: 3, gate: 3, proactive: 3, review: 2, thought: 1 };
  const bodyOf = (event) => String(event.summary || event.text || '')
    .replace(/^(丢弃|保留|暂缓|没开口|\[shadow\][^：]*)[：:]\s*/, '')
    .trim();
  const kept = [];
  for (const event of events) {
    const body = bodyOf(event);
    const at = Date.parse(event.ts || event.at || '');
    if (!body || !Number.isFinite(at)) {
      kept.push(event);
      continue;
    }
    const index = kept.findIndex((item) => {
      const otherAt = Date.parse(item.ts || item.at || '');
      return bodyOf(item) === body && Number.isFinite(otherAt) && Math.abs(otherAt - at) < 5_000;
    });
    if (index < 0) {
      kept.push(event);
    } else if ((priority[event.type] || 0) > (priority[kept[index].type] || 0)) {
      kept[index] = event;
    }
  }
  return kept;
}

export default {
  panels: {
    life: {
      mount: async (ctx) => {
        const { root } = ctx;
        const doc = root.ownerDocument;
        let style = doc.getElementById(STYLE_ID);
        if (!style) {
          style = doc.createElement('style');
          style.id = STYLE_ID;
          doc.head.appendChild(style);
        }
        style.textContent = CSS;

        const el = (tag, cls, text) => {
          const node = doc.createElement(tag);
          if (cls) node.className = cls;
          if (text !== undefined) node.textContent = text;
          return node;
        };
        const app = el('div', 'cp-app');
        const viewRoot = el('div', 'cp-view');
        const tabs = [
          ['now', '此刻'], ['memory', '记忆'], ['mind', '心理'], ['bond', '关系'],
        ];
        let current = 'now';
        const tabButtons = new Map();

        const head = el('div', 'cp-head');
        const brand = el('div', 'cp-brand');
        const avatar = el('div', 'cp-avatar', '鲸');
        const brandText = el('div');
        const title = el('input', 'cp-name-input');
        title.type = 'text';
        title.maxLength = 20;
        title.value = '大肥鱼';
        title.setAttribute('aria-label', '她的称呼');
        title.title = '点击改名，回车保存';
        const sub = el('small', '', '');
        const commitName = async () => {
          const value = title.value.trim() || '大肥鱼';
          try {
            const result = await ctx.invoke('rename', [value]);
            title.value = result.name || value;
            if (dash) dash.name = result.name || value;
          } catch {
            title.value = dash?.name || '大肥鱼';
          }
        };
        title.addEventListener('change', () => void commitName());
        title.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            title.blur();
          } else if (event.key === 'Escape') {
            title.value = dash?.name || '大肥鱼';
            title.blur();
          }
        });
        brandText.append(title, sub);
        brand.append(avatar, brandText);
        const status = el('div', 'cp-status');
        const dot = el('span', 'cp-dot');
        const statusText = el('span', '', '读取中…');
        status.append(dot, statusText);
        const grow = el('div', 'cp-grow');
        const tabBar = el('nav', 'cp-tabs');
        for (const [id, label] of tabs) {
          const button = el('button', 'cp-tab', label);
          button.type = 'button';
          button.addEventListener('click', () => show(id));
          tabButtons.set(id, button);
          tabBar.append(button);
        }
        head.append(brand, status, grow, tabBar);

        const nowView = el('div');
        const memoryView = el('div');
        memoryView.style.display = 'none';
        const mindView = el('div');
        mindView.style.display = 'none';
        const bondView = el('div');
        bondView.style.display = 'none';
        viewRoot.append(nowView, memoryView, mindView, bondView);
        app.append(head, viewRoot);
        root.append(app);
        const fit = () => {
          const width = app.clientWidth || 0;
          app.classList.toggle('cp-narrow', width > 0 && width < 760);
          app.classList.toggle('cp-mid', width >= 760 && width < 1120);
        };
        fit();
        if (typeof ResizeObserver === 'function') new ResizeObserver(fit).observe(app);

        let dash = null;
        let graph = null;
        let selectedId = null;
        let hoverId = null;
        let errorText = '';
        let searchHits = null;
        let searchQuery = '';
        let searchError = '';
        let mergeNotice = '';
        let memoryMode = 'graph';
        let mindType = '';

        let fullscreenKey = null;
        function setGraphFullscreen(on) {
          const mem = memoryView.querySelector('.cp-mem');
          if (!mem) return;
          mem.classList.toggle('cp-fullscreen', on);
          const button = mem.querySelector('.cp-fsbtn');
          if (button) button.textContent = on ? '退出全屏' : '全屏';
          doc.body.style.overflow = on ? 'hidden' : '';
          if (on) {
            if (!fullscreenKey) {
              fullscreenKey = (event) => {
                if (event.key === 'Escape') setGraphFullscreen(false);
              };
              doc.addEventListener('keydown', fullscreenKey);
            }
          } else if (fullscreenKey) {
            doc.removeEventListener('keydown', fullscreenKey);
            fullscreenKey = null;
          }
          resizeSoon();
        }

        function setAutoRotate(on) {
          if (canvasState) canvasState.autoRotate = on;
          const normal = memoryView.__parts?.autoBtn;
          const full = memoryView.__parts?.fsAutoBtn;
          if (normal) normal.classList.toggle('on', on);
          if (full) full.classList.toggle('on', on);
        }

        function show(id) {
          if (id !== 'memory') setGraphFullscreen(false);
          if (id === 'memory' && current !== 'memory' && canvasState) setAutoRotate(true);
          current = id;
          for (const [key, button] of tabButtons) button.classList.toggle('on', key === id);
          nowView.style.display = id === 'now' ? '' : 'none';
          memoryView.style.display = id === 'memory' ? '' : 'none';
          mindView.style.display = id === 'mind' ? '' : 'none';
          bondView.style.display = id === 'bond' ? '' : 'none';
          if (id === 'memory') void ensureGraph();
          if (id === 'mind') void loadMind();
          if (id === 'bond') renderBond();
          if (id === 'now') renderNow();
          resizeSoon();
        }

        function section(label, extra) {
          const box = el('section', 'cp-card');
          const top = el('div', 'cp-lbl');
          top.append(doc.createTextNode(label));
          if (extra) top.append(extra);
          box.append(top);
          return box;
        }

        function pctClass(kind) {
          return COLORS[kind] ?? '#7b93b8';
        }

        function renderNow() {
          nowView.replaceChildren();
          if (errorText) {
            nowView.append(el('div', 'cp-err', errorText));
          }
          if (!dash) {
            nowView.append(el('div', 'cp-empty', '读取中…'));
            return;
          }
          const d = dash;
          statusText.textContent = `${d.now.weekday} ${d.now.time} · ${d.now.sleeping ? '睡觉' : d.now.activity}`;
          sub.textContent = d.now.date;
          if (doc.activeElement !== title) title.value = d.name || '大肥鱼';

          const grid = el('div', 'cp-grid cp-now-grid');
          const hero = section('此刻');
          hero.classList.add('cp-now-hero');
          const row = el('div', 'cp-row');
          const a = el('div', 'cp-avatar', '鲸');
          a.style.width = '58px'; a.style.height = '58px'; a.style.fontSize = '28px';
          const info = el('div');
          info.append(el('p', 'cp-name', '我会永远陪着你'));
          const rel = d.relationship;
          info.append(el('div', 'cp-sub', `${rel.relation || '陪伴'} · 认识第 ${rel.daysTogether ?? '—'} 天`));
          const chips = el('div', 'cp-row');
          chips.style.marginTop = '5px'; chips.style.gap = '5px';
          chips.append(el('span', 'cp-pill', d.now.mood > 65 ? '心情不错' : d.now.mood < 40 ? '有点低落' : '平静'));
          chips.append(el('span', 'cp-pill gold', `在${d.now.location}`));
          info.append(chips);
          row.append(a, info);
          hero.append(row);

          const main = el('div', 'cp-row');
          main.style.margin = '14px 0 8px'; main.style.gap = '13px';
          const ring = el('div', 'cp-ring');
          ring.style.background = `conic-gradient(var(--teal) 0 ${Math.max(0, Math.min(100, d.now.energy))}%,#eee7d8 ${Math.max(0, Math.min(100, d.now.energy))}% 100%)`;
          const rv = el('span', '', String(d.now.energy));
          ring.append(rv);
          const mainText = el('div');
          mainText.append(el('div', '', `正在${d.now.activity}`));
          const next = (d.agenda || []).find((item) => item.time > d.now.time);
          mainText.append(el('div', 'cp-sub', next ? `下一件：${next.time} ${next.title}` : '今天没有下一件了'));
          mainText.append(el('div', 'cp-sub', '下一次主动：等生活触发'));
          main.append(ring, mainText);
          hero.append(main);

          const stats = el('div', 'cp-stats');
          for (const [label, value] of [
            ['今日主动', `${d.counts.proactiveToday} / ${d.counts.proactiveCap || '不限'}`],
            ['今日走神', `${d.counts.musingToday} / ${d.counts.musingCap}`],
          ]) {
            const box = el('div', 'cp-stat');
            box.append(el('span', '', label), el('b', '', value));
            stats.append(box);
          }
          hero.append(stats);

          const side = el('div', 'cp-now-side');
          side.append(renderMemoryMini(d), renderBondMini(d));
          const decisionCard = renderDecision(d.decision);
          decisionCard.classList.add('cp-now-dec');
          grid.append(hero, side, decisionCard);
          const dayCard = renderDay(d);
          dayCard.classList.add('cp-daywide');
          const feed = renderFeed(d.mind || []);
          feed.classList.add('cp-feed');
          nowView.append(grid, dayCard, feed);
        }

        function renderDay(d) {
          const card = section('她的一天');
          const bar = el('div', 'cp-daybar');
          const startMin = 6 * 60;
          const endMin = 24 * 60;
          const pct = (minutes) => ((minutes - startMin) / (endMin - startMin)) * 100;
          for (const hour of [6, 9, 12, 15, 18, 21, 24]) {
            const h = el('span', 'cp-hour', String(hour));
            h.style.left = `${pct(hour * 60)}%`;
            bar.append(h);
          }
          const agenda = Array.isArray(d.agenda) ? d.agenda : [];
          const rowEnds = [-1, -1, -1];
          agenda.forEach((item) => {
            const [hh, mm] = String(item.time || '00:00').split(':').map(Number);
            const start = pct(hh * 60 + (mm || 0));
            if (!Number.isFinite(start) || start < 0 || start > 100) return;
            let row = rowEnds.findIndex((end) => start > end + 2);
            if (row < 0) row = 0;
            rowEnds[row] = start + 30;
            const slot = el('div', 'cp-slot');
            slot.style.left = `${start}%`;
            slot.style.top = `${22 + row * 31}px`;
            slot.style.width = `${Math.min(30, 100 - start)}%`;
            slot.innerHTML = `<b>${item.time}</b> · ${String(item.title || '').slice(0, 7)}`;
            bar.append(slot);
          });
          const nowParts = String(d.now.time || '00:00').split(':').map(Number);
          const nowLine = el('div', 'cp-nowline');
          nowLine.style.left = `${pct(nowParts[0] * 60 + (nowParts[1] || 0))}%`;
          bar.append(nowLine);

          const eventStyles = {
            proactive: ['主动', '#c46e59'],
            gate: ['被拦', '#c9a24b'],
            journal: ['日记', '#8d7aa8'],
            memory: ['记忆', '#427f77'],
          };
          const marks = [];
          const seenMarkKeys = new Set();
          for (const event of d.timeline || []) {
            if (!eventStyles[event.kind]) continue;
            const date = new Date(event.at);
            if (!Number.isFinite(date.getTime())) continue;
            const minutes = date.getHours() * 60 + date.getMinutes();
            if (minutes < startMin || minutes > endMin) continue;
            const markKey = `${event.kind}:${minutes}`;
            if (seenMarkKeys.has(markKey)) continue;
            seenMarkKeys.add(markKey);
            marks.push({ event, minutes, pct: pct(minutes) });
          }
          marks.sort((a, b) => a.minutes - b.minutes);
          const labelEnds = [-100, -100];
          for (const markData of marks.slice(-10)) {
            const [labelText, color] = eventStyles[markData.event.kind];
            const time = `${String(Math.floor(markData.minutes / 60)).padStart(2, '0')}:${String(markData.minutes % 60).padStart(2, '0')}`;
            const dot = el('div', 'cp-mark');
            dot.style.left = `${markData.pct}%`;
            dot.style.top = '116px';
            dot.style.background = color;
            bar.append(dot);
            let row = labelEnds.findIndex((end) => markData.pct > end + 1);
            if (row < 0) row = 1;
            labelEnds[row] = markData.pct + 11;
            const label = el('div', 'cp-mlabel');
            label.style.left = `${Math.max(7, Math.min(93, markData.pct))}%`;
            label.style.top = `${123 + row * 18}px`;
            const dotInLabel = el('i');
            dotInLabel.style.background = color;
            label.append(dotInLabel, doc.createTextNode(`${labelText} ${time}`));
            bar.append(label);
          }
          card.append(bar);
          const legend = el('div', 'cp-legend');
          legend.innerHTML = '<span><i style="background:#6f8fb0"></i>日程</span>'
            + '<span><i style="background:#c46e59"></i>主动开口</span>'
            + '<span><i style="background:#c9a24b"></i>被拦</span>'
            + '<span><i style="background:#8d7aa8"></i>日记/记忆</span>';
          card.append(legend);
          return card;
        }

        function renderDecision(decision) {
          const card = section('主动联系');
          if (!decision) {
            const empty = el('div', 'cp-empty');
            empty.style.padding = '42px 10px';
            empty.textContent = '还没有最近一次主动决策；等她下一次评估，或打开「心理」看候选。';
            card.append(empty);
            return card;
          }
          const ok = decision.code === 'send' || decision.score >= decision.threshold;
          const head = el('div', 'cp-row');
          const score = el('div', 'cp-decscore', decision.score >= 0 ? `+${decision.score.toFixed(2)}` : decision.score.toFixed(2));
          score.append(el('small', '', ` / 阈值 ${Number(decision.threshold).toFixed(2)}`));
          head.append(score, el('span', `cp-badge${ok ? ' ok' : ''}`, ok ? '开口' : '暂缓'));
          card.append(head);
          card.append(el('div', 'cp-sub', `${new Date(decision.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} · 由头「${String(decision.source || '')}」`));
          const terms = Array.isArray(decision.terms) ? decision.terms : [];
          if (terms.length) {
            const max = Math.max(0.1, ...terms.map((term) => Math.abs(term.value)));
            const rows = el('div', 'cp-rows');
            for (const term of terms) {
              const row = el('div', 'cp-drow');
              row.append(el('span', '', String(term.label)));
              const track = el('div', 'cp-track');
              const fill = el('i', 'cp-fill');
              fill.style.width = `${Math.min(100, (Math.abs(term.value) / max) * 50)}%`;
              fill.style[term.value >= 0 ? 'left' : 'right'] = '50%';
              fill.style.background = term.value >= 0 ? 'var(--teal)' : 'var(--coral)';
              track.append(fill);
              row.append(track, el('b', '', `${term.value >= 0 ? '+' : ''}${term.value.toFixed(2)}`));
              rows.append(row);
            }
            card.append(rows);
          }
          const foot = el('div', 'cp-decfoot');
          foot.textContent = decision.reason || '';
          card.append(foot);
          return card;
        }

        function renderMemoryMini(d) {
          const card = section('她的记忆');
          const facts = el('div', 'cp-mini3');
          for (const [label, value] of [
            ['记录', d.memory.records], ['规则', d.memory.rules], ['话头', d.memory.threads],
          ]) {
            const box = el('div');
            box.append(el('span', '', label), el('b', '', String(value)));
            facts.append(box);
          }
          card.append(facts);
          card.append(el('div', 'cp-sub', `已归档 ${d.memory.archived} · 合并 ${d.memory.merged} · ${Math.round(d.memory.bytes / 1024)} KB`));
          const go = el('button', 'cp-chip', '打开记忆星图 →');
          go.style.marginTop = '8px';
          go.addEventListener('click', () => show('memory'));
          card.append(go);
          return card;
        }

        function renderBondMini(d) {
          const card = section('你和她');
          const top = el('div', 'cp-reltop');
          top.append(el('span', 'cp-big', String(d.relationship.daysTogether ?? '—')), el('span', 'cp-sub', '天'));
          card.append(top);
          const bar = el('div', 'cp-relbar');
          const fill = el('i');
          fill.style.width = `${Math.round((d.relationship.closeness ?? 0.5) * 100)}%`;
          bar.append(fill);
          card.append(bar);
          card.append(el('div', 'cp-sub', `亲密度 ${Number(d.relationship.closeness ?? 0.5).toFixed(2)} · 还欠 ${d.relationship.promises} 个约定`));
          const go = el('button', 'cp-chip', '看她眼里的你 →');
          go.style.marginTop = '8px';
          go.addEventListener('click', () => show('bond'));
          card.append(go);
          return card;
        }

        function renderFeed(mind) {
          const card = section('心理活动');
          const list = el('div', 'cp-feedlist');
          const recent = [...collapseMind(mind)].reverse().slice(0, 6);
          if (!recent.length) card.append(el('div', 'cp-empty', '今天还没有心理活动记录。'));
          for (const event of recent) {
            const item = el('div', 'cp-ev');
            item.append(el('time', '', new Date(event.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })));
            const tag = el('span', 'tag', MIND_LABEL[event.type] || '记录');
            item.append(tag, doc.createTextNode(String(event.text || '').slice(0, 110)));
            list.append(item);
          }
          card.append(list);
          return card;
        }

        function renderBond() {
          bondView.replaceChildren();
          if (!dash) return;
          const d = dash;
          const grid = el('div', 'cp-grid');
          const rel = section('你和她');
          const top = el('div', 'cp-reltop');
          top.append(el('span', 'cp-big', String(d.relationship.daysTogether ?? '—')), el('span', 'cp-sub', '天 · 从她记事开始'));
          rel.append(top);
          const bar = el('div', 'cp-relbar');
          const fill = el('i');
          fill.style.width = `${Math.round((d.relationship.closeness ?? 0.5) * 100)}%`;
          bar.append(fill);
          rel.append(bar);
          rel.append(el('div', 'cp-sub', `亲密度 ${Number(d.relationship.closeness ?? 0.5).toFixed(2)} · 共同记忆 ${d.relationship.memories} 条 · 未完成约定 ${d.relationship.promises}`));
          const mini = el('div', 'cp-mini3');
          for (const [label, value] of [['被提起', d.relationship.surfaced], ['记录', d.memory.records], ['归档', d.memory.archived]]) {
            const box = el('div');
            box.append(el('span', '', label), el('b', '', String(value)));
            mini.append(box);
          }
          rel.append(mini);
          if (d.relationship.latestJournal) {
            rel.append(el('div', 'cp-sub', `最近日记：${d.relationship.latestJournal}`));
          }
          grid.append(rel);

          const modelCard = section('她眼里的你 · 用户模型');
          const model = el('div', 'cp-model');
          for (const item of d.model || []) {
            const row = el('div', 'cp-mrow');
            const tag = el('span', `cp-mtag${item.kind === 'hypothesis' ? ' h' : ''}`, item.kind === 'fact' ? '确定' : item.kind === 'hypothesis' ? '也许' : '习惯');
            row.append(tag, el('span', '', item.text), el('span', 'cp-conf', `${Math.round(item.confidence * 100)}%`));
            model.append(row);
          }
          if (!(d.model || []).length) model.append(el('div', 'cp-empty', '还没有推导出稳定的理解。'));
          modelCard.append(model);
          grid.append(modelCard);
          bondView.append(grid);
          const card = section('最近日记');
          const list = el('div');
          for (const entry of d.timeline.filter((event) => event.kind === 'journal').slice(-5).reverse()) {
            const line = el('div', 'cp-ev');
            line.style.marginBottom = '6px';
            line.textContent = new Date(entry.at).toLocaleDateString('zh-CN') + ' · ' + entry.text;
            list.append(line);
          }
          if (!list.childNodes.length) list.append(el('div', 'cp-empty', '还没有日记。'));
          card.append(list);
          bondView.append(card);
        }

        function makeMemoryView() {
          const toolbar = el('div', 'cp-toolstack');
          const searchRow = el('div', 'cp-toolbar');
          const input = el('input', 'cp-input');
          input.placeholder = '搜全库… 回车';
          input.addEventListener('input', () => {
            searchHits = null;
            searchQuery = '';
            searchError = '';
            selectedId = null;
            drawGraph();
            renderList();
          });
          input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void runSearch();
            }
          });
          const searchBtn = el('button', 'cp-chip', '全库搜索');
          searchBtn.type = 'button';
          searchBtn.addEventListener('click', () => void runSearch());
          searchRow.append(el('span', 'cp-toolhint', '搜索'), input, searchBtn);

          const viewRow = el('div', 'cp-toolbar');
          viewRow.append(el('span', 'cp-toolhint', '视图'));
          const viewButtons = new Map();
          for (const [mode, label] of [['overview', '概览'], ['graph', '星图'], ['list', '列表'], ['merge', '合并摘要']]) {
            const button = el('button', 'cp-chip', label);
            button.type = 'button';
            button.classList.toggle('on', mode === 'graph');
            button.addEventListener('click', () => showMemoryMode(mode));
            viewButtons.set(mode, button);
            viewRow.append(button);
          }

          const filterRow = el('div', 'cp-toolbar');
          filterRow.append(el('span', 'cp-toolhint', '筛选'));
          const kindChips = el('div', 'cp-row');
          kindChips.style.gap = '5px';
          const kinds = [['all', '全部'], ['rule', '规则'], ['person', '人物'], ['self', '自我'], ['thread', '话头'], ['fact', '事实'], ['episode', '经历']];
          let activeKind = 'all';
          const chipNodes = new Map();
          for (const [value, label] of kinds) {
            const chip = el('button', 'cp-chip', label);
            chip.type = 'button';
            chip.classList.toggle('on', value === activeKind);
            chip.addEventListener('click', () => {
              activeKind = value;
              if (memoryView.__parts) memoryView.__parts.activeKind = value;
              for (const [key, node] of chipNodes) node.classList.toggle('on', key === value);
              drawGraph();
              renderList();
            });
            chipNodes.set(value, chip);
            kindChips.append(chip);
          }
          filterRow.append(kindChips);

          const graphRow = el('div', 'cp-toolbar');
          graphRow.append(el('span', 'cp-toolhint', '星图'));
          const auto = el('button', 'cp-chip on', '自动旋转');
          auto.type = 'button';
          auto.addEventListener('click', () => {
            if (!canvasState) return;
            setAutoRotate(!canvasState.autoRotate);
          });
          const reset = el('button', 'cp-chip', '重置视角');
          reset.type = 'button';
          reset.addEventListener('click', () => {
            if (!canvasState) return;
            canvasState.yaw = 0.65;
            canvasState.pitch = 0.28;
            canvasState.zoom = 1;
            setAutoRotate(false);
            drawGraph();
          });
          graphRow.append(auto, reset);
          toolbar.append(searchRow, viewRow, filterRow, graphRow);

          const mem = el('div', 'cp-mem');
          const stage = el('div', 'cp-stage');
          const canvas = doc.createElement('canvas');
          const tip = el('div', 'cp-tip');
          const hint = el('div', 'hint', '拖动旋转 · 滚轮缩放 · 点节点看详情');
          const legend = el('div', 'cp-legend-float');
          legend.innerHTML = '<span><i style="background:#c89a4b"></i>规则</span>'
            + '<span><i style="background:#427f77"></i>人物/自我</span>'
            + '<span><i style="background:#c46e59"></i>话头</span>'
            + '<span><i style="background:#7b93b8"></i>经历</span>';
          const fsBtn = el('button', 'cp-fsbtn', '全屏');
          fsBtn.type = 'button';
          fsBtn.addEventListener('click', () => setGraphFullscreen(!mem.classList.contains('cp-fullscreen')));
          const fsbar = el('div', 'cp-fsbar');
          const fsAuto = el('button', 'on', '自动旋转');
          fsAuto.type = 'button';
          fsAuto.addEventListener('click', () => {
            if (!canvasState) return;
            setAutoRotate(!canvasState.autoRotate);
          });
          const fsReset = el('button', '', '重置');
          fsReset.type = 'button';
          fsReset.addEventListener('click', () => {
            if (!canvasState) return;
            canvasState.yaw = 0.65;
            canvasState.pitch = 0.28;
            canvasState.zoom = 1;
            setAutoRotate(false);
            drawGraph();
          });
          const fsExit = el('button', '', '退出全屏');
          fsExit.type = 'button';
          fsExit.addEventListener('click', () => setGraphFullscreen(false));
          fsbar.append(fsAuto, fsReset, fsExit);
          stage.append(canvas, tip, hint, legend, fsbar, fsBtn);
          const detail = el('div', 'cp-detail');
          detail.append(el('div', 'cp-empty', '在星图里点一个节点。'));
          const listview = el('div', 'cp-listview');
          const listWrap = el('div', 'cp-list');
          const searchDetail = el('div', 'cp-search-detail');
          listview.append(listWrap, searchDetail);
          const mergeview = el('div', 'cp-mergeview');
          const mergeWrap = el('div', 'cp-mergewrap');
          mergeview.append(mergeWrap);
          const overviewView = el('div', 'cp-overview');
          const overviewWrap = el('div');
          overviewView.append(overviewWrap);
          mem.append(stage, detail);
          memoryView.append(toolbar, el('div', 'cp-lbl', '她的记忆'), mem, listview, mergeview, overviewView);
          memoryView.__parts = {
            input, activeKind, chipNodes, canvas, tip, detail, listWrap, searchDetail, stage,
            autoBtn: auto, fsAutoBtn: fsAuto, viewButtons, filterRow, graphRow, listview, mergeview, mergeWrap,
            overviewView, overviewWrap,
          };
        }

        async function ensureGraph() {
          if (!dash) await loadDashboard();
          if (!graph) {
            try {
              graph = await ctx.invoke('constellation');
            } catch (error) {
              graph = { nodes: [], edges: [], error: error instanceof Error ? error.message : String(error) };
            }
            renderMemory();
            startCanvas();
            if (new URLSearchParams(doc.defaultView?.location.search || '').get('pick') && graph.nodes?.length) {
              selectedId = graph.nodes[0].id;
              renderDetail();
            }
            if (new URLSearchParams(doc.defaultView?.location.search || '').get('fs')) setGraphFullscreen(true);
            const presetQuery = new URLSearchParams(doc.defaultView?.location.search || '').get('q');
            if (presetQuery && memoryView.__parts) {
              memoryView.__parts.input.value = presetQuery;
              void runSearch();
            }
            if (new URLSearchParams(doc.defaultView?.location.search || '').get('merge')) {
              showMergeView(true);
              void loadMerges();
            }
            const presetView = new URLSearchParams(doc.defaultView?.location.search || '').get('view');
            if (presetView && ['overview', 'graph', 'list', 'merge'].includes(presetView)) showMemoryMode(presetView);
          } else {
            resizeSoon();
          }
        }

        function renderMemory() {
          canvasState?.cleanup?.();
          canvasState = null;
          setGraphFullscreen(false);
          searchHits = null;
          searchQuery = '';
          searchError = '';
          memoryView.replaceChildren();
          if (graph?.error) {
            memoryView.append(el('div', 'cp-err', `星图读取失败：${graph.error}`));
            return;
          }
          memoryMode = 'graph';
          makeMemoryView();
          renderList();
          showMemoryMode('graph');
        }

        function filteredNodes() {
          if (!graph) return [];
          const parts = memoryView.__parts;
          const query = String(parts?.input?.value || '').trim().toLowerCase();
          const kind = parts?.activeKind || 'all';
          return (graph.nodes || []).filter((node) => {
            if (kind !== 'all' && node.kind !== kind) return false;
            if (query && !`${node.text} ${node.tags.join(' ')}`.toLowerCase().includes(query)) return false;
            return true;
          });
        }

        function showMemoryMode(mode) {
          memoryMode = mode;
          const parts = memoryView.__parts;
          if (!parts) return;
          for (const [key, button] of parts.viewButtons) button.classList.toggle('on', key === mode);
          parts.overviewView.classList.toggle('on', mode === 'overview');
          parts.stage.classList.toggle('hidden', mode !== 'graph');
          parts.detail.classList.toggle('hidden', mode !== 'graph');
          parts.listview.classList.toggle('on', mode === 'list');
          parts.mergeview.classList.toggle('on', mode === 'merge');
          parts.filterRow.style.display = mode === 'graph' || mode === 'list' ? 'flex' : 'none';
          parts.graphRow.style.display = mode === 'graph' ? 'flex' : 'none';
          if (mode !== 'graph') setGraphFullscreen(false);
          if (mode === 'graph') resizeSoon();
          if (mode === 'list') renderList();
          if (mode === 'merge') void loadMerges();
          if (mode === 'overview') void loadOverview();
        }

        function showListView(on) {
          showMemoryMode(on ? 'list' : 'graph');
        }

        function showMergeView(on) {
          showMemoryMode(on ? 'merge' : 'graph');
        }

        async function loadOverview() {
          const parts = memoryView.__parts;
          if (!parts) return;
          parts.overviewWrap.replaceChildren(el('div', 'cp-empty', '读取概览…'));
          try {
            const [overview, recent] = await Promise.all([
              ctx.invoke('overview'),
              ctx.invoke('recent'),
            ]);
            renderOverview(overview, recent.recent ?? []);
          } catch (error) {
            parts.overviewWrap.replaceChildren(el('div', 'cp-err', `读取失败：${error instanceof Error ? error.message : String(error)}`));
          }
        }

        function renderOverview(overview, recent) {
          const parts = memoryView.__parts;
          if (!parts) return;
          const wrap = parts.overviewWrap;
          wrap.replaceChildren();
          const stats = el('div', 'cp-ovgrid');
          const cells = [
            ['记录', overview.records], ['事件', overview.events], ['规则', overview.rules], ['人物', overview.people],
            ['归档', overview.archived], ['合并', overview.merged], ['走神', overview.musing], ['范围', Object.keys(overview.byScope ?? {}).length],
          ];
          for (const [label, value] of cells) {
            const box = el('div', 'cp-ovstat');
            box.append(el('span', '', label), el('b', '', String(value ?? 0)));
            stats.append(box);
          }
          wrap.append(stats);
          wrap.append(el('div', 'cp-lbl', '最近记忆'));
          const list = el('div', 'cp-recent');
          if (!recent.length) list.append(el('div', 'cp-empty', '还没有最近记忆。'));
          for (const row of recent.slice(0, 12)) {
            const item = el('div', 'cp-recentrow');
            item.append(el('time', '', row.date || String(row.ts || '').slice(0, 10)));
            item.append(el('b', '', KIND_LABEL[row.kind] || row.kind), doc.createTextNode(' · '));
            item.append(doc.createTextNode(String(row.text || '').slice(0, 120)));
            list.append(item);
          }
          wrap.append(list);
        }

        async function runSearch() {
          const parts = memoryView.__parts;
          if (!parts) return;
          const query = String(parts.input.value || '').trim();
          if (!query) {
            searchHits = null;
            searchQuery = '';
            searchError = '';
            renderList();
            return;
          }
          searchQuery = query;
          searchError = '';
          try {
            const result = await ctx.invoke('search', [query, '*', 50]);
            searchHits = result.hits ?? [];
          } catch (error) {
            searchHits = [];
            searchError = error instanceof Error ? error.message : String(error);
          }
          selectedId = null;
          showListView(true);
          renderList();
        }

        function renderSearchResults() {
          const parts = memoryView.__parts;
          if (!parts) return;
          const wrap = parts.listWrap;
          wrap.replaceChildren();
          parts.searchDetail.replaceChildren();
          const meta = el('div', 'cp-searchmeta', `全库搜索「${searchQuery}」· ${searchHits.length} 条`);
          wrap.append(meta);
          if (searchError) {
            wrap.append(el('div', 'cp-err', `搜索失败：${searchError}`));
            return;
          }
          if (!searchHits.length) {
            wrap.append(el('div', 'cp-empty', '全库没有命中。换个关键词试试。'));
            return;
          }
          const table = el('table', 'cp-table');
          const head = doc.createElement('thead');
          const hr = doc.createElement('tr');
          for (const label of ['类型', '日期', '内容', '重要度']) hr.append(el('th', '', label));
          head.append(hr);
          table.append(head);
          const body = doc.createElement('tbody');
          for (const hit of searchHits) {
            const tr = doc.createElement('tr');
            tr.append(el('td', '', KIND_LABEL[hit.kind] || hit.kind));
            tr.append(el('td', '', hit.date || String(hit.ts || '').slice(0, 10)));
            tr.append(el('td', '', String(hit.text || hit.snippet || '').slice(0, 100)));
            tr.append(el('td', '', hit.importance !== undefined ? Number(hit.importance).toFixed(2) : '—'));
            tr.addEventListener('click', () => showSearchDetail(hit));
            body.append(tr);
          }
          table.append(body);
          wrap.append(table);
        }

        function showSearchDetail(hit) {
          const parts = memoryView.__parts;
          if (!parts) return;
          const box = parts.searchDetail;
          box.replaceChildren();
          box.append(el('h3', '', String(hit.text || hit.snippet || '').slice(0, 120)));
          box.append(el('div', 'cp-sub', `${KIND_LABEL[hit.kind] || hit.kind} · ${hit.date || ''} · scope ${hit.scope || '—'} · 相关度 ${Number(hit.score || 0).toFixed(2)}`));
          const text = el('p', '', String(hit.text || hit.snippet || ''));
          box.append(text);
          if (hit.tags?.length) {
            const tags = el('div', 'tagline');
            for (const tag of hit.tags) tags.append(el('span', '', tag));
            box.append(tags);
          }
          if (hit.evidence?.length) {
            box.append(el('div', 'cp-lbl', '证据'));
            for (const quote of hit.evidence) box.append(el('p', '', String(quote).slice(0, 160)));
          }
          const node = (graph?.nodes || []).find((item) => item.id === hit.id);
          if (node) {
            const locate = el('button', 'cp-chip', '在星图中定位');
            locate.type = 'button';
            locate.addEventListener('click', () => {
              selectedId = hit.id;
              showListView(false);
              drawGraph();
              renderDetail();
            });
            box.append(locate);
          }
        }

        async function loadMerges() {
          const parts = memoryView.__parts;
          if (!parts) return;
          parts.mergeWrap.replaceChildren(el('div', 'cp-empty', '读取合并摘要…'));
          try {
            const result = await ctx.invoke('merges');
            renderMerges(result.merges ?? []);
          } catch (error) {
            parts.mergeWrap.replaceChildren(el('div', 'cp-err', `读取失败：${error instanceof Error ? error.message : String(error)}`));
          }
        }

        function renderMerges(rows) {
          const parts = memoryView.__parts;
          if (!parts) return;
          const wrap = parts.mergeWrap;
          wrap.replaceChildren();
          if (mergeNotice) wrap.append(el('div', 'cp-msg', mergeNotice));
          if (!rows.length) {
            wrap.append(el('div', 'cp-empty', '没有合并摘要。'));
            return;
          }
          for (const row of rows) {
            const card = el('div', 'cp-mergecard');
            card.append(el('h4', '', `${row.date} · ${row.count} 条原文 → 1 条摘要`));
            card.append(el('p', '', String(row.text || '').slice(0, 260)));
            card.append(el('div', 'cp-sub', `scope ${row.scope}`));
            const acts = el('div', 'cp-mergeacts');
            const undo = el('button', '', '撤销合并');
            undo.type = 'button';
            undo.addEventListener('click', () => void unmergeRecord(row));
            acts.append(undo);
            card.append(acts);
            wrap.append(card);
          }
        }

        async function unmergeRecord(row) {
          const ok = !doc.defaultView?.confirm || doc.defaultView.confirm('撤销这次合并？原文会恢复为可检索，摘要会删除。');
          if (!ok) return;
          mergeNotice = '';
          try {
            const result = await ctx.invoke('unmerge', [row.id]);
            mergeNotice = result.restored ? `已恢复 ${result.restored} 条原文` : '这条摘要已不存在，可能已被撤销。';
          } catch (error) {
            mergeNotice = `撤销失败：${error instanceof Error ? error.message : String(error)}`;
          }
          graph = null;
          selectedId = null;
          await ensureGraph();
          await loadMerges();
          showMergeView(true);
          void loadDashboard();
        }

        function renderList() {
          if (!memoryView.__parts) return;
          if (searchHits) {
            renderSearchResults();
            return;
          }
          memoryView.__parts.searchDetail.replaceChildren();
          const nodes = filteredNodes();
          const wrap = memoryView.__parts.listWrap;
          wrap.replaceChildren();
          if (!nodes.length) {
            wrap.append(el('div', 'cp-empty', '没有命中。'));
            return;
          }
          const table = el('table', 'cp-table');
          const head = doc.createElement('thead');
          const hr = doc.createElement('tr');
          for (const label of ['类型', '日期', '内容', '重要度']) hr.append(el('th', '', label));
          head.append(hr);
          table.append(head);
          const body = doc.createElement('tbody');
          for (const node of nodes.slice(0, 180)) {
            const tr = doc.createElement('tr');
            tr.append(el('td', '', KIND_LABEL[node.kind] || node.kind));
            tr.append(el('td', '', node.date));
            tr.append(el('td', '', node.text.slice(0, 80)));
            tr.append(el('td', '', Number(node.importance).toFixed(2)));
            tr.addEventListener('click', () => {
              selectedId = node.id;
              drawGraph();
              renderDetail();
            });
            body.append(tr);
          }
          table.append(body);
          wrap.append(table);
        }

        function renderDetail() {
          if (!memoryView.__parts) return;
          const detail = memoryView.__parts.detail;
          const node = (graph?.nodes || []).find((item) => item.id === selectedId);
          detail.replaceChildren();
          if (!node) {
            detail.append(el('div', 'cp-empty', '在星图里点一个节点。'));
            return;
          }
          detail.append(el('h3', '', node.text.slice(0, 110)));
          detail.append(el('div', 'meta', `${KIND_LABEL[node.kind] || node.kind} · ${node.date} · 重要度 ${Number(node.importance).toFixed(2)} · 置信 ${Number(node.confidence ?? 0).toFixed(2)}`));
          detail.append(el('p', '', node.text));
          const tags = el('div', 'tagline');
          for (const tag of node.tags || []) tags.append(el('span', '', tag));
          detail.append(tags);
          if (node.evidence?.length) {
            detail.append(el('div', 'cp-lbl', '证据'));
            for (const quote of node.evidence) detail.append(el('p', '', String(quote).slice(0, 160)));
          }
          const degree = (graph?.edges || []).filter((edge) => edge.a === node.id || edge.b === node.id).length;
          detail.append(el('div', 'cp-sub', `scope：${node.scope} · 连线 ${degree}`));
        }

        let canvasState = null;
        function drawGraph() {
          canvasState?.recompute?.();
        }
        function startCanvas() {
          const parts = memoryView.__parts;
          if (!parts || canvasState) return;
          const canvas = parts.canvas;
          const tip = parts.tip;
          const stage = parts.stage;
          const state = {
            yaw: 0.65, pitch: 0.28, zoom: 1, drag: false, moved: false,
            autoRotate: true, hovering: false, t: 0,
            lastX: 0, lastY: 0, frame: 0, dpr: 1, w: 1, h: 1,
            points: [], projected: [],
          };
          canvasState = state;

          const resize = () => {
            const rect = stage.getBoundingClientRect();
            state.w = Math.max(120, rect.width);
            state.h = Math.max(120, rect.height);
            state.dpr = Math.min(2, doc.defaultView?.devicePixelRatio || 1);
            canvas.width = Math.round(state.w * state.dpr);
            canvas.height = Math.round(state.h * state.dpr);
            canvas.style.width = `${state.w}px`;
            canvas.style.height = `${state.h}px`;
            computePositions();
            const hint = stage.querySelector('.hint');
            if (hint) hint.textContent = `节点 ${state.points.length} · 连线 ${state.edgePairs?.length ?? 0}`;
            draw();
          };
          const ro = new ResizeObserver(resize);
          ro.observe(stage);
          resize();

          function computePositions() {
            const nodes = filteredNodes();
            const w = state.w, h = state.h;
            state.points = nodes.map((node, index) => {
              const hashValue = hash(node.id);
              const layer = node.kind === 'rule' || node.kind === 'person' || node.kind === 'self' ? 0.28
                : node.kind === 'thread' ? 0.58 : 0.82 + ((hashValue >>> 5) % 17) / 100;
              const theta = ((hashValue % 360) / 180) * Math.PI;
              const phi = (((hashValue >>> 9) % 180) / 180) * Math.PI;
              const r = layer + ((hashValue >>> 17) % 11) / 200;
              return {
                node,
                x: r * Math.sin(phi) * Math.cos(theta),
                y: r * Math.cos(phi),
                z: r * Math.sin(phi) * Math.sin(theta),
                size: 3 + node.importance * 5 + (layer < 0.3 ? 1.5 : 0),
              };
            });
            state.recompute = computePositions;
            state.edgePairs = (graph?.edges || []).map((edge) => ({
              a: state.points.find((point) => point.node.id === edge.a),
              b: state.points.find((point) => point.node.id === edge.b),
              type: edge.type,
            })).filter((edge) => edge.a && edge.b);
          }

          function project(point) {
            const cy = Math.cos(state.yaw), sy = Math.sin(state.yaw);
            let x = point.x * cy - point.z * sy;
            let z = point.x * sy + point.z * cy;
            const cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
            const y = point.y * cp - z * sp;
            z = point.y * sp + z * cp;
            const camera = 3.1;
            const depth = Math.max(0.35, camera - z);
            const scale = Math.min(state.w, state.h) * 0.95 * state.zoom;
            return {
              x: state.w / 2 + (x * scale) / depth,
              y: state.h / 2 + (y * scale) / depth,
              z,
              radius: ((point.size * 1.5) / depth) * Math.max(0.8, Math.min(1.9, Math.min(state.w, state.h) / 620)),
              alpha: Math.max(0.18, Math.min(1, (depth - 1.3) / 1.8)),
            };
          }

          function draw() {
            if (!memoryView.__parts || memoryView.__parts.canvas !== canvas) return;
            const ctx2d = canvas.getContext('2d');
            if (!ctx2d) return;
            ctx2d.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
            ctx2d.clearRect(0, 0, state.w, state.h);
            const t = state.t || 0;
            const reduceMotion = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
            const bg = ctx2d.createRadialGradient(state.w * 0.5, state.h * 0.45, 10, state.w * 0.5, state.h * 0.5, Math.max(state.w, state.h) * 0.7);
            bg.addColorStop(0, '#1b2d49');
            bg.addColorStop(0.55, '#101d31');
            bg.addColorStop(1, '#080e19');
            ctx2d.fillStyle = bg;
            ctx2d.fillRect(0, 0, state.w, state.h);
            // 缓慢漂移的星云色团
            ctx2d.save();
            ctx2d.globalCompositeOperation = 'screen';
            const blobs = [
              { x: 0.28 + Math.sin(t * 0.05) * 0.04, y: 0.34 + Math.cos(t * 0.04) * 0.03, r: 0.52, rgb: '66,132,160' },
              { x: 0.74 + Math.cos(t * 0.045) * 0.04, y: 0.62 + Math.sin(t * 0.05) * 0.03, r: 0.5, rgb: '126,92,168' },
              { x: 0.52 + Math.sin(t * 0.035) * 0.03, y: 0.5 + Math.cos(t * 0.06) * 0.03, r: 0.34, rgb: '72,140,126' },
            ];
            for (const blob of blobs) {
              const cx = blob.x * state.w;
              const cy = blob.y * state.h;
              const radius = blob.r * Math.max(state.w, state.h);
              const gradient = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, radius);
              gradient.addColorStop(0, `rgba(${blob.rgb},.14)`);
              gradient.addColorStop(0.45, `rgba(${blob.rgb},.05)`);
              gradient.addColorStop(1, `rgba(${blob.rgb},0)`);
              ctx2d.fillStyle = gradient;
              ctx2d.fillRect(0, 0, state.w, state.h);
            }
            ctx2d.restore();
            // 闪烁星尘
            for (let i = 0; i < 130; i += 1) {
              const rx = (hash(`star-${i}`) % 1000) / 1000;
              const ry = (hash(`sky-${i}`) % 1000) / 1000;
              const phase = (hash(`phase-${i}`) % 628) / 100;
              const twinkle = reduceMotion ? 0.35 : 0.16 + 0.34 * (0.5 + 0.5 * Math.sin(t * 1.4 + phase));
              ctx2d.fillStyle = `rgba(200,218,245,${twinkle})`;
              ctx2d.fillRect(rx * state.w, ry * state.h, i % 17 === 0 ? 2 : 1, 1);
            }
            // 慢慢上浮的尘埃
            for (let i = 0; i < 26; i += 1) {
              const baseX = (hash(`dust-x-${i}`) % 1000) / 1000;
              const baseY = (hash(`dust-y-${i}`) % 1000) / 1000;
              const speed = 0.002 + ((hash(`dust-s-${i}`) % 30) / 10000);
              const y = (baseY - (reduceMotion ? 0 : t * speed)) % 1;
              const alpha = 0.08 + ((hash(`dust-a-${i}`) % 12) / 100);
              ctx2d.fillStyle = `rgba(170,195,225,${alpha})`;
              ctx2d.fillRect(((baseX + Math.sin(t * 0.2 + i) * 0.004 + 1) % 1) * state.w, (y + 1) % 1 * state.h, 1, 1);
            }
            // 中心微光 + 边缘压暗
            const glow = ctx2d.createRadialGradient(state.w / 2, state.h / 2, 0, state.w / 2, state.h / 2, Math.min(state.w, state.h) * 0.45);
            glow.addColorStop(0, 'rgba(110,184,174,.10)');
            glow.addColorStop(0.45, 'rgba(110,184,174,.03)');
            glow.addColorStop(1, 'rgba(110,184,174,0)');
            ctx2d.fillStyle = glow;
            ctx2d.fillRect(0, 0, state.w, state.h);
            const vignette = ctx2d.createRadialGradient(state.w / 2, state.h / 2, Math.min(state.w, state.h) * 0.3, state.w / 2, state.h / 2, Math.max(state.w, state.h) * 0.72);
            vignette.addColorStop(0, 'rgba(4,8,15,0)');
            vignette.addColorStop(1, 'rgba(4,8,15,.5)');
            ctx2d.fillStyle = vignette;
            ctx2d.fillRect(0, 0, state.w, state.h);
            const projected = state.points.map((point) => ({ ...project(point), node: point.node }));
            state.projected = projected;
            // edges
            const activeId = selectedId || hoverId;
            ctx2d.lineWidth = 0.7;
            for (const edge of state.edgePairs || []) {
              const a = projected.find((point) => point.node.id === edge.a.node.id);
              const b = projected.find((point) => point.node.id === edge.b.node.id);
              if (!a || !b) continue;
              const connected = activeId && (edge.a.node.id === activeId || edge.b.node.id === activeId);
              ctx2d.lineWidth = connected ? 1.5 : activeId ? 0.45 : 0.7;
              ctx2d.strokeStyle = connected
                ? 'rgba(255,216,145,.78)'
                : activeId
                  ? 'rgba(120,145,180,.045)'
                  : `rgba(150,175,215,${Math.min(0.32, (a.alpha + b.alpha) * 0.14)})`;
              ctx2d.beginPath();
              ctx2d.moveTo(a.x, a.y);
              ctx2d.lineTo(b.x, b.y);
              ctx2d.stroke();
            }
            if (activeId) {
              ctx2d.save();
              ctx2d.strokeStyle = 'rgba(255,224,160,.85)';
              ctx2d.lineWidth = 1.7;
              ctx2d.setLineDash([3, 7]);
              ctx2d.lineDashOffset = reduceMotion ? 0 : -t * 18;
              ctx2d.shadowColor = 'rgba(255,214,130,.7)';
              ctx2d.shadowBlur = 8;
              for (const edge of state.edgePairs || []) {
                if (edge.a.node.id !== activeId && edge.b.node.id !== activeId) continue;
                const a = projected.find((point) => point.node.id === edge.a.node.id);
                const b = projected.find((point) => point.node.id === edge.b.node.id);
                if (!a || !b) continue;
                ctx2d.beginPath();
                ctx2d.moveTo(a.x, a.y);
                ctx2d.lineTo(b.x, b.y);
                ctx2d.stroke();
              }
              ctx2d.restore();
            }
            // nodes far to near
            projected.sort((a, b) => a.z - b.z);
            for (const point of projected) {
              const color = COLORS[point.node.kind] || '#7b93b8';
              const dim = selectedId && point.node.id !== selectedId ? 0.34 : 1;
              ctx2d.globalAlpha = Math.max(0.25, point.alpha) * dim;
              ctx2d.fillStyle = color;
              ctx2d.beginPath();
              ctx2d.arc(point.x, point.y, Math.max(1.6, point.radius), 0, Math.PI * 2);
              ctx2d.fill();
              if (point.node.kind === 'rule' || point.node.kind === 'person' || point.node.kind === 'self') {
                ctx2d.strokeStyle = 'rgba(255,248,236,.55)';
                ctx2d.lineWidth = 1;
                ctx2d.stroke();
              }
            }
            ctx2d.globalAlpha = 1;
            const selectedPoint = projected.find((point) => point.node.id === selectedId);
            if (selectedPoint) {
              ctx2d.save();
              const pulse = reduceMotion ? 1 : 1 + Math.sin(t * 3.2) * 0.16;
              ctx2d.shadowColor = 'rgba(255,214,130,.9)';
              ctx2d.shadowBlur = 22;
              ctx2d.strokeStyle = '#ffe3a0';
              ctx2d.lineWidth = 2;
              ctx2d.beginPath();
              ctx2d.arc(selectedPoint.x, selectedPoint.y, Math.max(8, selectedPoint.radius + 7), 0, Math.PI * 2);
              ctx2d.stroke();
              ctx2d.globalAlpha = 0.35;
              ctx2d.beginPath();
              ctx2d.arc(selectedPoint.x, selectedPoint.y, Math.max(13, selectedPoint.radius + 13) * pulse, 0, Math.PI * 2);
              ctx2d.stroke();
              ctx2d.restore();
            }
            // labels: selected, hover, top important
            const labels = projected
              .filter((point) => point.node.id === selectedId || point.node.id === hoverId)
              .concat(projected.filter((point) => (point.node.kind === 'episode' || point.node.kind === 'fact')
                && point.node.importance >= 0.85).slice(0, 4));
            const used = new Set();
            const labelScale = Math.max(0.85, Math.min(1.4, Math.min(state.w, state.h) / 620));
            ctx2d.font = `${Math.round(10 * labelScale)}px "Microsoft YaHei",sans-serif`;
            ctx2d.textAlign = 'center';
            for (const point of labels) {
              if (used.has(point.node.id)) continue;
              used.add(point.node.id);
              const text = point.node.text.slice(0, 16);
              const width = ctx2d.measureText(text).width + 8;
              const boxHeight = 13 * labelScale;
              ctx2d.fillStyle = 'rgba(11,18,32,.72)';
              ctx2d.fillRect(point.x - width / 2, point.y - point.radius - boxHeight - 2, width, boxHeight);
              ctx2d.fillStyle = '#dbe6f5';
              ctx2d.fillText(text, point.x, point.y - point.radius - 6);
            }
          }

          function loop() {
            if (!memoryView.__parts || memoryView.__parts.canvas !== canvas || !canvas.isConnected) return;
            const reduce = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
            if (!reduce) state.t = (state.t || 0) + 0.016;
            if (state.autoRotate && !state.drag && !reduce) state.yaw += 0.0016;
            draw();
            state.frame = doc.defaultView?.requestAnimationFrame(loop) ?? 0;
          }
          loop();
          draw();

          const hit = (x, y) => {
            let best = null;
            for (const point of state.projected) {
              const distance = Math.hypot(point.x - x, point.y - y);
              if (distance <= Math.max(10, point.radius + 7) && (!best || distance < best.distance)) {
                best = { point, distance };
              }
            }
            return best?.point ?? null;
          };

          canvas.addEventListener('pointerenter', () => { state.hovering = true; });
          canvas.addEventListener('pointerdown', (event) => {
            state.drag = true;
            state.moved = false;
            setAutoRotate(false);
            state.lastX = event.clientX;
            state.lastY = event.clientY;
            canvas.setPointerCapture?.(event.pointerId);
          });
          canvas.addEventListener('pointermove', (event) => {
            const rect = canvas.getBoundingClientRect();
            if (state.drag) {
              const dx = event.clientX - state.lastX;
              const dy = event.clientY - state.lastY;
              if (Math.abs(dx) + Math.abs(dy) > 2) state.moved = true;
              state.yaw += dx * 0.008;
              state.pitch = Math.max(-1.1, Math.min(1.1, state.pitch + dy * 0.006));
              state.lastX = event.clientX;
              state.lastY = event.clientY;
              return;
            }
            const point = hit(event.clientX - rect.left, event.clientY - rect.top);
            hoverId = point?.node.id ?? null;
            canvas.style.cursor = point ? 'pointer' : 'grab';
            if (point) {
              tip.style.display = 'block';
              tip.style.left = `${Math.min(state.w - 230, event.clientX - rect.left + 10)}px`;
              tip.style.top = `${Math.max(8, event.clientY - rect.top - 28)}px`;
              tip.textContent = `${KIND_LABEL[point.node.kind] || point.node.kind} · ${point.node.text.slice(0, 42)}`;
            } else {
              tip.style.display = 'none';
            }
          });
          canvas.addEventListener('pointerup', (event) => {
            state.drag = false;
            if (!state.moved) {
              const rect = canvas.getBoundingClientRect();
              const point = hit(event.clientX - rect.left, event.clientY - rect.top);
              if (point) {
                selectedId = point.node.id;
                setAutoRotate(false);
                renderDetail();
              } else {
                selectedId = null;
                renderDetail();
              }
            }
          });
          canvas.addEventListener('pointerleave', () => {
            state.hovering = false;
            hoverId = null;
            tip.style.display = 'none';
          });
          canvas.addEventListener('wheel', (event) => {
            event.preventDefault();
            setAutoRotate(false);
            state.zoom = Math.max(0.25, Math.min(6, state.zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
          }, { passive: false });

          state.cleanup = () => {
            ro.disconnect();
            if (state.frame && doc.defaultView) doc.defaultView.cancelAnimationFrame(state.frame);
          };
        }

        function resizeSoon() {
          if (!canvasState) return;
          doc.defaultView?.requestAnimationFrame(() => {
            const stage = memoryView.querySelector('.cp-stage');
            if (!stage) return;
            const rect = stage.getBoundingClientRect();
            if (rect.width > 0 && canvasState) {
              canvasState.w = rect.width;
              canvasState.h = rect.height;
              const canvas = memoryView.__parts?.canvas;
              if (canvas) {
                canvasState.dpr = Math.min(2, doc.defaultView?.devicePixelRatio || 1);
                canvas.width = Math.round(rect.width * canvasState.dpr);
                canvas.height = Math.round(rect.height * canvasState.dpr);
              }
            }
          });
        }

        async function loadDashboard() {
          try {
            dash = await ctx.invoke('dashboard');
            errorText = '';
          } catch (error) {
            errorText = `读取失败：${error instanceof Error ? error.message : String(error)}`;
            dash = null;
          }
          renderNow();
          if (current === 'bond') renderBond();
          if (current === 'memory' && graph) renderMemory();
        }

        async function loadMind(type = mindType) {
          mindType = type;
          mindView.replaceChildren();
          const card = section('心理活动');
          const filters = el('div', 'cp-toolbar');
          filters.append(el('span', 'cp-toolhint', '筛选'));
          const types = [['', '全部'], ['proactive', '主动'], ['gate', '被拦'], ['thought', '念头'], ['memory', '记忆'], ['trigger', '触发'], ['candidate', '候选'], ['review', '复盘'], ['action', '动作'], ['echo', '回声']];
          for (const [value, label] of types) {
            const button = el('button', 'cp-chip', label);
            button.type = 'button';
            button.classList.toggle('on', value === mindType);
            button.addEventListener('click', () => void loadMind(value));
            filters.append(button);
          }
          card.append(filters);
          try {
            const result = await ctx.invoke('mind', [100, type]);
            const events = collapseMind(result.events || []);
            if (!events.length) card.append(el('div', 'cp-empty', '这个筛选下还没有记录。'));
            const list = el('div', 'cp-feedlist');
            list.style.gridTemplateColumns = '1fr 1fr';
            for (const event of events.slice(0, 40)) {
              const item = el('div', 'cp-ev');
              item.append(el('time', '', new Date(event.ts).toLocaleString('zh-CN', { hour12: false }).slice(5)));
              item.append(el('span', 'tag', MIND_LABEL[event.type] || '记录'), doc.createTextNode(String(event.summary || '').slice(0, 110)));
              list.append(item);
            }
            card.append(list);
          } catch (error) {
            card.append(el('div', 'cp-err', `读取失败：${error instanceof Error ? error.message : String(error)}`));
          }
          mindView.append(card);
        }

        const requested = new URLSearchParams(doc.defaultView?.location.search || '').get('cp');
        if (requested && tabs.some(([id]) => id === requested)) show(requested);
        else show('now');
        await loadDashboard();
        ctx.interval(() => {
          if (ctx.root.ownerDocument?.visibilityState === 'hidden') return;
          if (current === 'now') void loadDashboard();
          if (current === 'bond') renderBond();
        }, 20_000);
      },
    },
  },
};
