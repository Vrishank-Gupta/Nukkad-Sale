import type { Child, FC } from 'hono/jsx'
import { raw } from 'hono/html'
import type { OrderStatus, ShipStatus } from '../env'
import type { Dict } from '../i18n'
import { TRACK_JS } from '../lib/analytics'

// One small inline stylesheet: no CSS framework, no web fonts, nothing extra to download on 3G.
const CSS = `
:root{--bg:#faf7f2;--card:#fff;--ink:#1d1a16;--muted:#6f675d;--line:#e6dfd2;--brand:#d9480f;--brand-ink:#fff;--brand-soft:#fff1e8;
--ok:#2b8a3e;--ok-soft:#e9f7ec;--warn:#b35c00;--warn-soft:#fff4e0;--bad:#c92a2a;--bad-soft:#fdeaea;--info:#1864ab;--info-soft:#e7f1fb;--wa:#1fa855;--bubble:#dcf8c6;--r:16px}
@media (prefers-color-scheme:dark){:root{--bg:#14120f;--card:#1e1b17;--ink:#f3eee7;--muted:#a69d91;--line:#3a342c;--brand:#ff7a3d;--brand-ink:#1a0d05;--brand-soft:#2e1d12;
--ok:#69db7c;--ok-soft:#16281a;--warn:#ffc078;--warn-soft:#2f2412;--bad:#ff8787;--bad-soft:#331818;--info:#74c0fc;--info-soft:#132433;--bubble:#1f3a2a}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}.modal{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px;z-index:60}.modal>.card{max-width:420px;width:100%;margin:0}
[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Devanagari",sans-serif}
main{max-width:560px;margin:0 auto;padding:4px 16px 96px}
header.top{max-width:560px;margin:0 auto;padding:max(10px,env(safe-area-inset-top)) 16px 4px;display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:56px}
header.top .brand{min-width:0;min-height:40px;font-weight:700;font-size:1.02rem;text-decoration:none;color:var(--ink);display:flex;align-items:center;gap:9px}header.top .brand span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.logo{flex:none;width:28px;height:28px;border-radius:8px;background:var(--brand);color:#fff;display:flex;align-items:center;justify-content:center}
.lang{flex:none;font:inherit;font-weight:600;font-size:.82rem;height:40px;min-width:40px;padding:0 10px;border:1px solid var(--line);border-radius:10px;text-decoration:none;color:var(--ink);background:var(--card);display:inline-flex;align-items:center;justify-content:center;gap:4px;cursor:pointer}.lang.ib{padding:0;width:36px;color:var(--muted)}
.tools{display:flex;gap:6px;flex:none}[data-say][hidden]{display:none}
.bigok{width:76px;height:76px;border-radius:50%;background:var(--ok);color:#fff;font-size:2.4rem;display:flex;align-items:center;justify-content:center;margin:18px auto 8px;animation:pop .45s cubic-bezier(.2,1.6,.4,1)}
@keyframes pop{from{transform:scale(.3);opacity:0}to{transform:scale(1);opacity:1}}
.buybar{position:fixed;left:0;right:0;bottom:0;z-index:6;background:var(--card);border-top:1px solid var(--line);padding:10px 16px calc(10px + env(safe-area-inset-bottom));display:flex;align-items:center;gap:12px;transition:transform .25s}
.buybar.gone{transform:translateY(120%)}.buybar .btn{flex:1;max-width:360px;margin-left:auto}
.nudge{animation:nudge 1s ease-in-out 3}@keyframes nudge{50%{transform:scale(1.04);box-shadow:0 0 0 6px var(--ok-soft)}}
.appgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.appgrid a{min-height:56px}
.langpick{display:flex;gap:10px}.langpick a{flex:1;min-height:52px;font-size:1rem}
h1{font-size:1.4rem;font-weight:700;line-height:1.2;margin:.35em 0 .45em;letter-spacing:-.01em}h2{font-size:1rem;font-weight:650;margin:1.6em 0 .55em}
a{color:var(--brand)}p{margin:.4em 0}small,.muted{color:var(--muted)}small{font-size:.84rem}
.i{flex:none;vertical-align:-.22em}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:10px 0}
.row{display:flex;gap:10px;align-items:center}.between{justify-content:space-between}.wrap{flex-wrap:wrap}.grow{flex:1;min-width:0}
.stack>*+*{margin-top:14px}
label{display:block;font-weight:600;font-size:.9rem;margin-bottom:6px}
input,textarea,select{width:100%;font:inherit;font-size:16px;color:inherit;background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:11px 14px;min-height:48px}
input:focus,textarea:focus,select:focus{outline:none;border-color:var(--brand)}
textarea{min-height:92px;resize:vertical}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 16px;border-radius:12px;border:1.5px solid var(--line);
background:var(--card);color:var(--ink);font:inherit;font-size:.95rem;font-weight:600;text-decoration:none;cursor:pointer;-webkit-tap-highlight-color:transparent;text-align:center;line-height:1.25}
.btn:active{transform:scale(.98)}.btn.block{display:flex;width:100%}
.btn.primary{background:var(--brand);border-color:var(--brand);color:var(--brand-ink)}
.btn.ok{background:var(--ok);border-color:var(--ok);color:#fff}.btn.wa{background:var(--wa);border-color:var(--wa);color:#fff}
.btn.sm{min-height:40px;padding:0 12px;font-size:.86rem;border-radius:10px}.btn.ghost{background:transparent}
.btn[disabled]{opacity:.5;pointer-events:none}
.big{font-size:1rem;min-height:52px}
.bar{height:12px;background:var(--line);border-radius:99px;overflow:hidden;display:flex}
.bar i{display:block;height:100%;background:var(--brand)}.bar i.held{background:var(--warn);opacity:.55}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:.86rem;color:var(--muted);margin-top:8px}
.legend b{color:var(--ink)}.dot{display:inline-block;width:10px;height:10px;border-radius:99px;margin-right:5px;vertical-align:0}
.chip{display:inline-block;font-size:.74rem;font-weight:600;padding:2px 9px;border-radius:99px;white-space:nowrap}
.chip.paid,.chip.sold{background:var(--ok-soft);color:var(--ok)}.chip.pending,.chip.live{background:var(--warn-soft);color:var(--warn)}
.chip.verifying{background:var(--info-soft);color:var(--info)}.chip.expired,.chip.rejected,.chip.closed{background:var(--line);color:var(--muted)}
.chip.refund_due{background:var(--bad-soft);color:var(--bad)}
.order{border-left:4px solid var(--line)}.order.paid{border-left-color:var(--ok)}.order.pending{border-left-color:var(--warn)}
.order.verifying{border-left-color:var(--info)}.order.refund_due{border-left-color:var(--bad)}
.alert{padding:12px 14px;border-radius:12px;margin:10px 0;font-size:.92rem;font-weight:500;line-height:1.45}.alert.bad{background:var(--bad-soft);color:var(--bad)}
.alert.ok{background:var(--ok-soft);color:var(--ok)}.alert.warn{background:var(--warn-soft);color:var(--warn)}.alert.info{background:var(--info-soft);color:var(--info)}
.ask{background:var(--info-soft);border-radius:14px;padding:14px;margin-top:10px}.ask .q{font-weight:650;font-size:1rem;color:var(--info)}
.morerow{display:flex;gap:10px;overflow-x:auto;margin:0 -16px;padding:0 16px 6px;scrollbar-width:none}
.moreitem{flex:0 0 140px;text-decoration:none;color:inherit}.moreitem img{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:12px;display:block;background:var(--line)}
.moreitem b{display:block;font-size:.9rem;line-height:1.25;margin-top:6px}.moreitem small{display:block}
.shopgrid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.shopgrid .moreitem{flex:none}
.legal h2{margin-top:1.4em}.legal li{margin:.3em 0}
footer.site{max-width:560px;margin:0 auto;padding:8px 16px 28px;text-align:center;font-size:.85rem;color:var(--muted)}footer.site a{color:var(--muted);display:inline-block;padding:10px 4px}
.setup .meter{height:6px;border-radius:99px;background:var(--line);overflow:hidden;margin:10px 0 4px}.setup .meter i{display:block;height:100%;background:var(--brand);border-radius:99px}
input.switch{appearance:none;-webkit-appearance:none;flex:none;width:46px!important;min-width:46px;height:28px;min-height:0!important;padding:0!important;border:0!important;box-shadow:none;border-radius:99px;background:var(--line);position:relative;cursor:pointer;transition:background .15s;margin:0}
input.switch:before{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .15s}
input.switch:checked{background:var(--ok)}input.switch:checked:before{transform:translateX(18px)}input.switch:focus-visible{outline:2px solid var(--brand);outline-offset:2px}label:has(input.switch) small{font-weight:500;color:var(--muted)}
.saletools{margin:4px 0 6px}.tool{padding:0}.tool>summary{display:flex;gap:12px;align-items:center;padding:14px 16px;cursor:pointer;list-style:none}.tool>summary::-webkit-details-marker{display:none}
.tool>summary .ic{width:36px;height:36px;border-radius:10px;background:var(--brand-soft);color:var(--brand);display:inline-flex;align-items:center;justify-content:center;flex:none}
.tool>summary small{display:block;color:var(--muted);font-weight:500;line-height:1.35}.tool>summary:after{content:"";width:8px;height:8px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:rotate(45deg);flex:none;margin-left:4px}
.tool[open]>summary:after{transform:rotate(-135deg)}.tool>:not(summary){margin-left:16px;margin-right:16px}.tool[open]{padding-bottom:14px}
details.quiet{margin:-4px 0 10px}details.quiet>summary{list-style:none;cursor:pointer;color:var(--muted);font-size:.88rem;min-height:44px;display:flex;align-items:center}details.quiet>summary::-webkit-details-marker{display:none}
.setuplist{list-style:none;padding:0;margin:6px 0 0}.setuplist li{display:flex;align-items:center;gap:12px;min-height:46px;border-top:1px solid var(--line)}.setuplist li:first-child{border-top:0}
.setuplist .tick,.setuplist .dot{width:24px;height:24px;border-radius:99px;flex:none;display:inline-flex;align-items:center;justify-content:center}
.setuplist .tick{background:var(--ok);color:var(--card)}.setuplist .dot{border:2px solid var(--line)}.setuplist li.next .dot{border-color:var(--brand);background:var(--brand-soft)}
.setuplist li.done>span:not(.tick){color:var(--muted)}.setuplist a{flex:1;min-height:46px;display:flex;align-items:center;justify-content:space-between;gap:8px;color:inherit;text-decoration:none}.setuplist li.next a{font-weight:700;color:var(--brand)}
.empty{text-align:center;padding:36px 20px 28px;color:var(--muted)}.empty .ic{width:56px;height:56px;border-radius:16px;background:var(--brand-soft);color:var(--brand);display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px}
.empty b{display:block;color:var(--ink);font-size:1.02rem;margin-bottom:4px}.empty p{margin:0 auto;max-width:300px;font-size:.92rem}
.back{display:inline-flex;align-items:center;min-height:40px;padding-right:8px}
.vh{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.gallery{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;border-radius:var(--r);scrollbar-width:none;background:var(--line)}.gallery::-webkit-scrollbar{display:none}
.gallery img{flex:0 0 100%;width:100%;aspect-ratio:1/1;object-fit:cover;scroll-snap-align:center;display:block}
.gcount{position:absolute;right:10px;bottom:10px;background:rgba(0,0,0,.6);color:#fff;font-size:.85rem;font-weight:700;padding:3px 10px;border-radius:99px}
.photos{display:flex;gap:8px;overflow-x:auto;margin-top:8px}.photos img{width:64px;height:64px;border-radius:10px;object-fit:cover;flex:none}
.hero{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:var(--r);background:var(--line);display:block}
.thumb{width:56px;height:56px;border-radius:10px;object-fit:cover;background:var(--line);flex:none;display:flex;align-items:center;justify-content:center;color:var(--muted)}
.price{font-size:1.6rem;font-weight:700}
.stat{font-size:clamp(1.05rem,5.2vw,1.7rem);font-weight:800;line-height:1.2;white-space:nowrap}
.weekbars{display:flex;align-items:flex-end;gap:6px;height:88px;margin:10px 0 6px}.weekbars span{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:4px}
.weekbars i{display:block;width:100%;max-width:28px;border-radius:4px 4px 2px 2px;background:color-mix(in srgb,var(--brand) 35%,transparent)}.weekbars small{font-size:.7rem}
.duo{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}.duo .card{margin:0}
.task{display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit;padding:12px 14px}
.task .ic{flex:none;width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,currentColor 8%,transparent)}.task b{display:block;font-weight:600;font-size:.95rem}.task small{display:block}.task .go{margin-left:auto;color:var(--muted);display:flex}
.task.info{background:var(--info-soft);border-color:transparent}.task.info .ic{color:var(--info)}.task.warn{background:var(--warn-soft);border-color:transparent}.task.warn .ic{color:var(--warn)}.task.bad{background:var(--bad-soft);border-color:transparent}.task.bad .ic{color:var(--bad)}
.pills{display:flex;gap:8px;flex-wrap:wrap}.pills input{position:absolute;opacity:0;pointer-events:none;width:1px;min-height:0}
.pills label{margin:0;padding:10px 16px;min-width:52px;min-height:44px;display:flex;align-items:center;justify-content:center;border:1.5px solid var(--line);border-radius:10px;background:var(--card);cursor:pointer;font-weight:600}
.pills input:checked+label{border-color:var(--brand);background:var(--brand-soft);color:var(--brand)}
.pills input:focus-visible+label{outline:3px solid var(--brand);outline-offset:2px}
.pills input:disabled+label{opacity:.4;text-decoration:line-through}
.pills.two label{flex:1}
.choice{display:flex;gap:12px;align-items:flex-start;border:1.5px solid var(--line);border-radius:12px;padding:12px 14px;cursor:pointer;font-weight:400;margin:0}
.choice:has(input:checked){border-color:var(--brand);background:var(--brand-soft)}
.tag{display:inline-block;font-size:.7rem;font-weight:600;padding:2px 8px;border-radius:99px;background:var(--ok-soft);color:var(--ok);vertical-align:2px;margin-left:4px}
.gw{display:none}form[data-mode=razorpay] .gw-rzp{display:block}
.optgroup{border:1.5px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--card)}.optgroup:has(input[name=mode]:checked){border-color:var(--brand)}.choice input{width:24px;min-height:24px;flex:none;margin:2px 0 0;accent-color:var(--brand)}
.stepper{display:flex;align-items:stretch;gap:8px}.stepper input{text-align:center;font-size:1.1rem;font-weight:700;min-width:0}
.stepper button{flex:none;width:48px;min-height:48px;font-size:1.3rem;font-weight:600;border-radius:12px;border:1.5px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
.stepper.compact{gap:4px}.stepper.compact button{width:40px;font-size:1.15rem}.stepper.compact input{padding:12px 4px;width:52px;flex:none}
.money{display:flex;align-items:center;border:1.5px solid var(--line);border-radius:12px;background:var(--card)}.money:focus-within{border-color:var(--brand)}
.money span{padding-left:14px;font-size:1.1rem;font-weight:600;color:var(--muted)}.money input{border:0;font-size:1.1rem;font-weight:600}
.tel{display:flex;align-items:center;border:1.5px solid var(--line);border-radius:12px;background:var(--card)}.tel:focus-within{border-color:var(--brand)}
.tel span{padding-left:14px;font-weight:600;color:var(--muted)}.tel input{border:0}
.photo{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;aspect-ratio:4/3;border:1.5px dashed var(--line);border-radius:var(--r);
background:var(--card);cursor:pointer;font-weight:600;color:var(--muted);overflow:hidden;position:relative;margin:0}
.photo .ic{display:flex}.photo img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.photo.has .ph{display:none}.photo .chg{display:none}.photo.has .chg{display:block;position:absolute;bottom:10px;background:var(--ink);color:var(--bg);padding:6px 14px;border-radius:99px;font-size:.9rem}
.photo input{position:absolute;opacity:0;width:1px;height:1px;min-height:0}
.num{display:inline-flex;width:24px;height:24px;border-radius:99px;background:var(--brand);color:var(--brand-ink);font-weight:700;align-items:center;justify-content:center;flex:none;font-size:.8rem}
.sec{display:flex;gap:10px;align-items:center;font-weight:650;font-size:1rem;margin:22px 0 10px}
.tabs{display:flex;gap:6px;overflow-x:auto;margin:8px 0 6px;scrollbar-width:none}.tabs::-webkit-scrollbar{display:none}
.tabs a{flex:1 0 auto;padding:8px 12px;min-height:40px;display:inline-flex;align-items:center;justify-content:center;border-radius:10px;border:1px solid var(--line);text-decoration:none;color:var(--muted);font-size:.85rem;font-weight:600;background:var(--card);text-align:center;white-space:nowrap}
.tabs a.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.bubble{white-space:pre-wrap;word-break:break-word;font:inherit;font-size:.95rem;background:var(--bubble);border-radius:4px 14px 14px 14px;padding:10px 12px;margin:0}
.steps{display:flex;margin:14px 0 6px}.steps span{flex:1;text-align:center;font-size:.74rem;color:var(--muted);position:relative}
.steps span::before{content:'';display:block;width:10px;height:10px;border-radius:99px;margin:0 auto 6px;background:var(--line);position:relative;z-index:1}
.steps span+span::after{content:'';position:absolute;top:4px;right:50%;width:100%;height:2px;background:var(--line)}.steps span.done+span.done::after{background:var(--ok)}
.steps span.done{color:var(--ok);font-weight:600}.steps span.done::before{background:var(--ok)}
nav.bottom{position:fixed;left:0;right:0;bottom:0;background:var(--card);border-top:1px solid var(--line);display:flex;justify-content:center;padding-bottom:env(safe-area-inset-bottom);z-index:5}
nav.bottom a{flex:1;max-width:140px;text-align:center;padding:8px 0 8px;text-decoration:none;color:var(--muted);font-size:.7rem;font-weight:600;position:relative;display:flex;flex-direction:column;align-items:center;gap:3px}
nav.bottom a.on{color:var(--brand)}
.badge{position:absolute;top:3px;left:50%;margin-left:6px;background:var(--bad);color:#fff;border-radius:99px;font-size:.66rem;font-weight:700;padding:1px 6px;line-height:1.4}
.qr svg{width:230px;height:230px;display:block;margin:10px auto;background:#fff;border-radius:12px}
.toast{position:fixed;left:50%;bottom:calc(84px + env(safe-area-inset-bottom));transform:translateX(-50%);width:max-content;max-width:min(400px,calc(100% - 32px));background:var(--ink);color:var(--bg);padding:11px 16px;border-radius:14px;font-size:.92rem;font-weight:600;line-height:1.35;z-index:70;text-align:left;box-shadow:0 8px 28px rgba(0,0,0,.25);animation:toastin .2s ease-out}
@keyframes toastin{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
.sticky-pay{position:sticky;bottom:0;background:linear-gradient(transparent,var(--bg) 25%);padding:20px 0 10px;margin:0 -2px}
body.hasnav .sticky-pay{bottom:calc(59px + env(safe-area-inset-bottom))}   /* stay above the bottom tab bar */
.countdown{font-size:2rem;font-weight:700;text-align:center;color:var(--warn);font-variant-numeric:tabular-nums}
details summary{cursor:pointer;font-weight:600;min-height:44px;display:flex;align-items:center;list-style:none}
details summary::-webkit-details-marker{display:none}details summary::after{content:'▾';margin-left:auto;color:var(--muted)}details[open] summary::after{content:'▴'}
hr{border:0;border-top:1px solid var(--line);margin:16px 0}
.or{display:flex;align-items:center;gap:10px;margin:12px 0 10px;color:var(--muted);font-size:.8rem}.or::before,.or::after{content:'';flex:1;border-top:1px solid var(--line)}
.chip.cod{background:var(--warn-soft);color:var(--warn)}.order.cod{border-left-color:var(--warn)}
.hint{font-size:.84rem;color:var(--muted);margin-top:6px;font-weight:400}

/* ---------- Storefront & cart ---------- */
.sfhead{display:flex;gap:14px;align-items:center;margin:8px 0 4px}.sfhead .av{width:56px;height:56px;border-radius:16px;background:var(--brand);color:#fff;display:flex;align-items:center;justify-content:center;flex:none}
.sfhead h1{margin:0;font-size:1.35rem}.offerband{display:flex;gap:8px;align-items:center;background:var(--ok-soft);color:var(--ok);border-radius:12px;padding:10px 12px;font-weight:700;font-size:.92rem;margin:10px 0}
.sfsearch{position:relative;margin:10px 0}.sfsearch input{padding-left:40px}.sfsearch svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--muted)}
.chips{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;margin:4px 0 12px}.chips::-webkit-scrollbar{display:none}
.chips button{flex:none;min-height:36px;padding:0 14px;border-radius:99px;border:1px solid var(--line);background:var(--card);color:var(--ink);font:inherit;font-weight:600;font-size:.88rem;cursor:pointer}
.chips button.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.sfgrid{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media (min-width:700px){.sfgrid{grid-template-columns:repeat(3,1fr)}}
.sfcard{display:flex;flex-direction:column;gap:6px;min-width:0}.sfcard a{text-decoration:none;color:inherit;display:flex;flex-direction:column;gap:6px}
.sfimg{position:relative}.sfimg img,.sfimg .ph{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:14px;display:block;background:var(--line)}.sfimg .ph{display:flex;align-items:center;justify-content:center;color:var(--muted)}
.badge2{position:absolute;left:8px;top:8px;background:var(--ink);color:var(--bg);font-size:.72rem;font-weight:800;padding:4px 8px;border-radius:8px}.badge2.off{left:auto;right:8px;background:var(--ok);color:#fff}.badge2.soon{background:var(--info);color:#fff}
.sfcard b{font-size:.95rem;line-height:1.3}.sfprice{display:flex;gap:6px;align-items:baseline;flex-wrap:wrap}.sfprice s{color:var(--muted);font-size:.85rem}
.sfcard .btn{min-height:40px}.sfcard.out{opacity:.55}
.cartbar{position:sticky;top:0;z-index:7;display:flex;align-items:center;gap:10px;background:var(--ink);color:var(--bg);border-radius:14px;padding:10px 14px;margin:6px 0 10px;text-decoration:none;font-weight:700;box-shadow:0 8px 22px rgba(0,0,0,.18)}
.cartbar .go{margin-left:auto;flex:none;white-space:nowrap;background:var(--brand);color:#fff;border-radius:10px;padding:6px 12px}.cartbar small{display:block;font-weight:600;opacity:.8;font-size:.78rem}
dialog.sheet{border:0;border-radius:20px 20px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom));width:100%;max-width:560px;margin:auto auto 0;background:var(--card);color:var(--ink)}
dialog.sheet::backdrop{background:rgba(0,0,0,.45)}
.cartline{display:flex;gap:12px;align-items:center;padding:12px 0;border-top:1px solid var(--line)}.cartline:first-child{border-top:0}.cartline img{width:56px;height:56px;border-radius:10px;object-fit:cover;flex:none;background:var(--line)}
/* ---------- Computer: sidebar navigation, wider pages ---------- */
.cols>div{min-width:0}
@media (min-width:1000px){
  body.hasnav{padding-left:240px}
  body.hasnav nav.bottom{top:0;right:auto;width:240px;flex-direction:column;justify-content:flex-start;gap:4px;padding:84px 14px 24px;border-top:0;border-right:1px solid var(--line)}
  body.hasnav nav.bottom a{flex:none;max-width:none;flex-direction:row;justify-content:flex-start;gap:12px;padding:11px 14px;border-radius:12px;font-size:.95rem}
  body.hasnav nav.bottom a.on{background:var(--brand-soft)}
  body.hasnav nav.bottom a .badge{position:static;margin-left:auto}
  body.hasnav header.top{max-width:1120px;padding-left:32px;padding-right:32px}
  body.hasnav main{max-width:1120px;padding:8px 32px 56px}
  body.hasnav main:not(.wide)>*{max-width:720px}   /* forms and lists: comfortable width, same left edge as the header */
  body.hasnav .sticky-pay{bottom:0}
  main.wide .cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 32px;align-items:start}
  main.wide .ordergrid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 20px;align-items:start}
  main.wide .ordergrid>h2,main.wide .ordergrid>p{grid-column:1/-1}
  .toast{left:calc(50% + 120px)}
  body.hasnav .photo{aspect-ratio:auto;height:280px}
}
`

// Tiny progressive-enhancement helpers shared by all pages. Everything still works without them.
const JS = `
function toast(m,ms){var d=document.createElement('div');d.className='toast';d.textContent=m;document.body.appendChild(d);setTimeout(function(){d.remove()},ms||2200)}
document.addEventListener('click',function(e){
  var c=e.target.closest('[data-copy]');
  if(c){e.preventDefault();var t=document.querySelector(c.dataset.copy);var s=t.value!==undefined?t.value:t.innerText;
    (navigator.clipboard?navigator.clipboard.writeText(s):Promise.reject()).catch(function(){var a=document.createElement('textarea');a.value=s;document.body.appendChild(a);a.select();document.execCommand('copy');a.remove()})
    .finally(function(){toast(c.dataset.done||document.body.dataset.copied)})}
  var k=e.target.closest('[data-confirm]');if(k&&!confirm(k.dataset.confirm)){e.preventDefault();return}
  var st=e.target.closest('[data-step]');if(st){e.preventDefault();var i=st.parentNode.querySelector('input');var v=(parseInt(i.value,10)||0)+parseInt(st.dataset.step,10);
    var mn=i.min!==''?+i.min:0;var mx=i.max!==''?+i.max:1e9;i.value=Math.max(mn,Math.min(mx,v));i.dispatchEvent(new Event('input',{bubbles:true}))}
  var fl=e.target.closest('[data-fill]');if(fl){var tg=document.querySelector(fl.dataset.fill);if(tg){tg.value=fl.dataset.val;tg.focus()}}
  var pv=e.target.closest('[data-showpin]');if(pv){e.preventDefault();var p=document.getElementById(pv.dataset.showpin);p.type=p.type==='password'?'text':'password'}
});
document.addEventListener('submit',function(e){var b=e.target.querySelector('[type=submit]');if(b&&!e.defaultPrevented)setTimeout(function(){b.disabled=true},0)});
document.querySelectorAll('[data-autohide]').forEach(function(el){setTimeout(function(){el.remove()},3200)});
document.querySelectorAll('[data-countdown]').forEach(function(el){var end=+el.dataset.countdown;function f(){var s=Math.max(0,Math.round((end-Date.now())/1000));
  el.textContent=Math.floor(s/60)+':'+String(s%60).padStart(2,'0');if(s>0)setTimeout(f,1000);else if(el.dataset.reload)location.reload()}f()});
// 🔊 Read the page's instructions aloud with the phone's own voice (free, works offline on most Androids).
document.querySelectorAll('[data-say]').forEach(function(b){if(!('speechSynthesis' in window)){b.hidden=true;return}
  b.addEventListener('click',function(){speechSynthesis.cancel();var u=new SpeechSynthesisUtterance(b.dataset.say);u.lang=document.documentElement.lang==='hi'?'hi-IN':'en-IN';u.rate=.92;speechSynthesis.speak(u)})});
function say(text){try{if(localStorage.getItem('kk_sound')==='0')return}catch(e){}if(navigator.vibrate)navigator.vibrate([120,60,120]);
  if('speechSynthesis' in window){var u=new SpeechSynthesisUtterance(text);u.lang=document.documentElement.lang==='hi'?'hi-IN':'en-IN';speechSynthesis.speak(u)}}
// Settings: show the chosen gateway's key fields (no :has(), so older Android Chrome works too).
document.querySelectorAll('form[data-mode]').forEach(function(f){f.addEventListener('change',function(e){if(e.target.name==='mode')f.dataset.mode=e.target.value})});
// Native share sheet (Android & iOS) for apps other than WhatsApp.
document.querySelectorAll('[data-share]').forEach(function(b){if(!navigator.share){b.hidden=true;return}
  b.addEventListener('click',function(){navigator.share({text:document.querySelector(b.dataset.share).innerText}).catch(function(){})})});
// Installable app: register the service worker, and offer "Install" – the real prompt on
// Android/desktop Chrome, step-by-step instructions on iPhone (Safari has no prompt).
if('serviceWorker' in navigator)addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})});
var kkStandalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true,kkPrompt=null;
function kkShowInstall(kind){var hid=false;try{hid=localStorage.getItem('kk_install_hide')==='1'}catch(e){}
  document.querySelectorAll('[data-install]').forEach(function(el){if(hid&&el.dataset.install!=='always')return;el.hidden=false;el.querySelectorAll('[data-for]').forEach(function(x){x.hidden=x.dataset.for!==kind})})}
function kkHideInstall(){document.querySelectorAll('[data-install]').forEach(function(el){el.hidden=true})}
addEventListener('beforeinstallprompt',function(e){e.preventDefault();kkPrompt=e;if(!kkStandalone)kkShowInstall('prompt')});
addEventListener('appinstalled',kkHideInstall);
if(!kkStandalone&&(/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)))kkShowInstall('ios');
document.addEventListener('click',function(e){var g=e.target.closest('[data-install-go]');if(g&&kkPrompt){kkPrompt.prompt();kkPrompt.userChoice.finally(function(){kkPrompt=null;kkHideInstall()})}
  var x=e.target.closest('[data-install-hide]');if(x){try{localStorage.setItem('kk_install_hide','1')}catch(e){}x.closest('[data-install]').hidden=true}});
document.querySelectorAll('[data-gallery]').forEach(function(g){var n=g.parentNode.querySelector('[data-gcount]');if(!n)return;
  g.addEventListener('scroll',function(){n.textContent=(Math.round(g.scrollLeft/g.clientWidth)+1)+' / '+g.children.length},{passive:true})});
// Share photos + caption in one go (Android & iPhone share sheet → WhatsApp), like a normal community post.
document.querySelectorAll('[data-share-photos]').forEach(function(b){var urls=JSON.parse(b.dataset.sharePhotos||'[]');
  try{if(!urls.length||!navigator.canShare||!navigator.canShare({files:[new File(['x'],'x.jpg',{type:'image/jpeg'})]}))return}catch(e){return}
  b.hidden=false;b.addEventListener('click',function(){var text=document.querySelector(b.dataset.shareText).innerText;
    Promise.all(urls.map(function(u,i){return fetch(u).then(function(r){return r.blob()}).then(function(bl){return new File([bl],'photo-'+(i+1)+'.jpg',{type:bl.type||'image/jpeg'})})}))
    .then(function(files){return navigator.share({files:files,text:text})}).catch(function(){})})});
// Drop ?ok=/?err= from the address bar so a refresh doesn't show the message again.
if(/[?&](ok|err)=/.test(location.search)){var u=new URL(location.href);u.searchParams.delete('ok');u.searchParams.delete('err');history.replaceState(null,'',u)}
`


// Line icons (24×24, stroke = currentColor), used instead of emoji so the app looks calm and consistent.
export const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  book: '<path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  refund: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20l1.2-5A8.5 8.5 0 1 1 21 11.5z"/>',
  pin: '<path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  camera: '<path d="M3 8a2 2 0 0 1 2-2h2.5l1.5-2h6l1.5 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>',
  bag: '<path d="M6 7h12l1 13H5z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  share: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 9.2-9.2M17 6l3 3M14 9l2 2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  pause: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z"/><circle cx="16" cy="14.5" r="1"/>',
  clip: '<path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  shop: '<path d="M5.2 3h13.6L21 9a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" fill="currentColor" stroke-width="1.4"/><path d="M5 12.6V21h14v-8.4M10 21v-5h4v5"/>',
  phone: '<path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 5 5L14 13l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 19h14"/>',
  square: '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/>',
  bolt: '<path d="M13.5 2 4 13.5h6.5L9.5 22 20 9.5h-6.6z" fill="currentColor" stroke="none"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5v5M18 9.5v5"/>',
} as const
export type IconName = keyof typeof ICONS
export const Icon: FC<{ n: IconName; s?: number }> = ({ n, s = 20 }) =>
  raw(`<svg class="i" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`)

export type Og = { title: string; description: string; image?: string; url: string }
export type Nav = 'home' | 'orders' | 'khata' | 'settings'

type LayoutProps = {
  t: Dict
  title: string
  path: string
  og?: Og
  nav?: Nav
  badge?: number
  brand?: string
  ok?: string
  /** Plain-words instructions for this screen, read aloud by the 🔊 button. */
  say?: string
  children: Child
  scripts?: string
  /** On a computer: use the full width (two-column pages). */
  wide?: boolean
}

export const Layout: FC<LayoutProps> = (p) => (
  <html lang={p.t.lang}>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
      <meta name="theme-color" content="#d9480f" />
      {/* Installable on both Android (manifest) and iPhone (apple-touch-icon) via "Add to Home Screen". */}
      <link rel="manifest" href="/manifest.webmanifest" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-title" content="NukkadSale" />
      <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      <meta name="format-detection" content="telephone=no" />
      <title>{p.title}</title>
      {p.og && (
        <>
          {/* WhatsApp renders these as the rich preview card when the link is pasted in a group. */}
          <meta property="og:title" content={p.og.title} />
          <meta property="og:description" content={p.og.description} />
          <meta property="og:url" content={p.og.url} />
          <meta property="og:type" content="product" />
          {p.og.image && <meta property="og:image" content={p.og.image} />}
          <meta name="description" content={p.og.description} />
        </>
      )}
      <link rel="icon" href="/icon-192.png" type="image/png" />
      <style>{raw(CSS)}</style>
    </head>
    <body data-copied={p.t.copied} class={p.nav ? 'hasnav' : undefined}>
      <header class="top">
        <a class="brand" href={p.nav ? '/app' : '/'}><i class="logo"><Icon n="shop" s={16} /></i><span>{(p.brand ?? 'NukkadSale').replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, '')}</span></a>
        <span class="tools">
          {p.say && <button type="button" class="lang ib" data-say={p.say} aria-label={p.t.listenLabel}><Icon n="volume" s={18} /></button>}
          {p.nav && <a class="lang ib" href="/app/help" aria-label={p.t.helpLabel}><Icon n="help" s={18} /></a>}
          <a class="lang" href={`/lang?to=${p.t.lang === 'en' ? 'hi' : 'en'}&back=${encodeURIComponent(p.path)}`} lang={p.t.lang === 'en' ? 'hi' : 'en'}>
            {p.t.otherLangLabel}
          </a>
        </span>
      </header>
      <main class={p.wide ? 'wide' : undefined}>{p.children}</main>
      {p.ok && <div class="toast" role="status" data-autohide>{p.ok}</div>}
      {!p.nav && (
        <footer class="site">
          <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/refunds">Refunds</a> · <a href="/contact">Contact</a>
        </footer>
      )}
      {p.nav && <BottomNav t={p.t} on={p.nav} badge={p.badge} />}
      <script>{raw(JS)}</script>
      {p.scripts && <script>{raw(p.scripts)}</script>}
      {!p.nav && <script>{raw(TRACK_JS)}</script>}
    </body>
  </html>
)

const BottomNav: FC<{ t: Dict; on: Nav; badge?: number }> = ({ t, on, badge }) => (
  <nav class="bottom">
    <a href="/app" class={on === 'home' ? 'on' : ''}><Icon n="home" s={22} />{t.navHome}</a>
    <a href="/app/orders" class={on === 'orders' ? 'on' : ''}>
      <Icon n="box" s={22} />{t.navOrders}{badge ? <span class="badge">{badge}</span> : null}
    </a>
    <a href="/app/khata" class={on === 'khata' ? 'on' : ''}><Icon n="book" s={22} />{t.navKhata}</a>
    <a href="/app/settings" class={on === 'settings' ? 'on' : ''}><Icon n="gear" s={22} />{t.navSettings}</a>
  </nav>
)

export const StockBar: FC<{ stock: number; sold: number; held: number }> = ({ stock, sold, held }) => {
  const pct = (n: number) => (stock ? Math.min(100, (n / stock) * 100) : 0).toFixed(1) + '%'
  return (
    <div class="bar" role="img" aria-label={`${sold} / ${stock}`} data-bar>
      <i style={`width:${pct(sold)}`} />
      <i class="held" style={`width:${pct(held)}`} />
    </div>
  )
}

/** Bar plus a plain-words legend: "● 7 sold  ● 2 being paid  ● 1 left". */
export const StockSummary: FC<{ t: Dict; stock: number; sold: number; held: number; available: number }> = ({ t, ...c }) => (
  <>
    <StockBar {...c} />
    <div class="legend">
      <span><i class="dot" style="background:var(--brand)" /><b>{c.sold}</b> {t.sold}</span>
      {c.held > 0 && <span><i class="dot" style="background:var(--warn);opacity:.55" /><b>{c.held}</b> {t.beingPaid}</span>}
      <span><i class="dot" style="background:var(--line)" /><b>{c.available}</b> {t.left}</span>
    </div>
  </>
)

export const StatusChip: FC<{ t: Dict; status: OrderStatus }> = ({ t, status }) => <span class={`chip ${status}`}>{t.status[status]}</span>

const SHIP_ORDER: ShipStatus[] = ['new', 'packed', 'shipped', 'delivered']

/** ● Paid — ● Packed — ○ Sent — ○ Delivered */
export const ShipSteps: FC<{ t: Dict; ship: ShipStatus; labels?: string[] }> = ({ t, ship, labels }) => {
  const at = SHIP_ORDER.indexOf(ship)
  return (
    <div class="steps">
      {(labels ?? t.shipSteps).map((label, i) => (
        <span class={i <= at ? 'done' : ''}>{label}</span>
      ))}
    </div>
  )
}

export const Flash: FC<{ msg?: string; kind?: 'bad' | 'ok' | 'info' }> = ({ msg, kind = 'bad' }) => (msg ? <div class={`alert ${kind}`} role="alert">{msg}</div> : null)

/** A calm empty state: icon, one line saying what's missing, one line saying what will appear here. */
export const Empty: FC<{ icon: IconName; title: string; sub?: string; children?: Child }> = (p) => (
  <div class="empty"><span class="ic"><Icon n={p.icon} s={26} /></span><b>{p.title}</b>{p.sub && <p>{p.sub}</p>}{p.children}</div>
)

export const Stepper: FC<{ id: string; name: string; value: number | string; min?: number; max?: number; required?: boolean; compact?: boolean; label?: string }> = (p) => (
  <div class={p.compact ? 'stepper compact' : 'stepper'}>
    <button type="button" data-step="-1" aria-label="Less">−</button>
    <input id={p.id || undefined} name={p.name} type="number" inputmode="numeric" min={p.min ?? 0} max={p.max} value={String(p.value)} required={p.required} aria-label={p.label} />
    <button type="button" data-step="1" aria-label="More">+</button>
  </div>
)

export const PhoneInput: FC<{ id: string; name: string; value?: string }> = (p) => (
  <div class="tel">
    <span>+91</span>
    <input id={p.id} name={p.name} type="tel" inputmode="numeric" autocomplete="tel-national" maxlength={14} placeholder="98XXXXXXXX" value={p.value} required />
  </div>
)

export const PinInput: FC<{ id: string; t: Dict; autocomplete: string; name?: string; autofocus?: boolean }> = ({ id, t, autocomplete, name = 'pin', autofocus }) => (
  <div class="row">
    <input class="grow" id={id} name={name} autofocus={autofocus} type="password" inputmode="numeric" autocomplete={autocomplete} pattern="\d{4,6}" maxlength={6} placeholder="••••" required style="letter-spacing:.3em;font-size:1.3rem" />
    <button type="button" class="btn sm" data-showpin={id}>{t.showPin}</button>
  </div>
)

/** "5 min ago" in the viewer's language. */
export function ago(t: Dict, ms: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return t.justNow
  if (s < 3600) return t.minAgo(Math.floor(s / 60))
  if (s < 86400) return t.hrAgo(Math.floor(s / 3600))
  return new Date(ms + 330 * 60000).toISOString().slice(0, 10).split('-').reverse().join('/')
}

/** "Install the app" card – hidden until the browser can actually install (or it's an iPhone). */
export const InstallCard: FC<{ t: Dict; always?: boolean }> = ({ t, always }) => (
  <div class="card" data-install={always ? 'always' : '1'} hidden style="border:1.5px solid var(--brand)">
    <div class="row" style="align-items:flex-start">
      <img src="/icon-192.png" class="thumb" alt="" />
      <div class="grow"><b>{t.installTitle}</b><small style="display:block">{t.installBody}</small></div>
      {!always && <button type="button" class="btn sm ghost" data-install-hide aria-label="Close" style="border:0;padding:0 8px"><Icon n="x" s={18} /></button>}
    </div>
    <button type="button" class="btn primary block" data-for="prompt" data-install-go style="margin-top:12px">{t.installBtn}</button>
    <p class="hint" data-for="ios" style="margin-top:10px">{t.installIos}</p>
  </div>
)

/** The base stylesheet and helpers, for pages with their own frame (the desktop admin portal). */
export const BASE_CSS = CSS
export const BASE_JS = JS
