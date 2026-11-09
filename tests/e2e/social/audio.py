# Builds a soundtrack per reel with ffmpeg only: beat (kick, hat, bass), an impact on the hook,
# whooshes on each cut, and a cash "ding" on the payment moment. Then muxes it with the video.
import json, subprocess, sys
DING = {1: [12.2], 2: [10.2], 3: [6.65], 4: [10.0], 5: [9.0], 6: [14.8]}
BPM = {24: 92, 1: 112, 2: 118, 3: 124, 4: 116, 5: 104, 6: 120, 7: 122, 8: 114, 9: 108, 10: 120, 11: 126, 12: 124, 13: 104, 14: 112, 15: 108, 16: 118}
IMPACT = {6: [0, 8.2]}  # default: just the hook
POPS = {6: [1.65 + i * .11 for i in range(16)]}  # one notification blip per incoming DM
for n in map(int, sys.argv[1:]):
    meta = json.load(open(f'out/reel-{n}.json')); d = meta['d']; cuts = meta['cuts'][1:]
    # cues saved by render.mjs from reels.html win over the tables above
    DING[n] = meta.get('ding') or DING.get(n, [])
    if meta.get('impact'): IMPACT[n] = meta['impact']
    if meta.get('pops'): POPS[n] = meta['pops']
    b = 60 / BPM.get(n, 116)
    T = f'mod(t,{b})'
    kick = f'0.9*sin(2*PI*{T}*(48+140*exp(-{T}*28)))*exp(-{T}*7)'
    hat = f'0.16*(random(0)*2-1)*exp(-mod(t+{b/2},{b})*80)'
    note = f'if(eq(mod(floor(t/{4*b}),4),0),55,if(eq(mod(floor(t/{4*b}),4),1),43.65,if(eq(mod(floor(t/{4*b}),4),2),65.41,49)))'
    bass = f'0.32*sin(2*PI*{note}*t)*(1-exp(-{T}*9))*exp(-mod(t,{b/2})*2.5)'
    # the beat drops in after the hook impact (t >= 0.45)
    beat = f'gte(t,0.45)*({kick}+{hat}+{bass})'
    impact = '+'.join(f'gte(t,{x})*1.1*sin(2*PI*(t-{x})*(38+180*exp(-(t-{x})*14)))*exp(-(t-{x})*3.2)' for x in IMPACT.get(n, [0]))
    pops = '+'.join(f'gte(t,{x})*0.45*sin(2*PI*(988+{(i*53)%220})*(t-{x}))*exp(-(t-{x})*38)' for i, x in enumerate(POPS.get(n, []))) or '0'
    whoosh = '+'.join(f'(random(1)*2-1)*exp(-pow(t-{c-0.12:.3f},2)/0.004)' for c in cuts) or '0'
    ding = '+'.join(f'gte(t,{x})*(0.5*sin(2*PI*1318.5*(t-{x}))+0.35*sin(2*PI*1760*(t-{x}))+0.2*sin(2*PI*2637*(t-{x})))*exp(-(t-{x})*6)' for x in DING[n]) or '0'
    fc = (f"aevalsrc='{beat}':s=44100:d={d}[a];aevalsrc='{impact}':s=44100:d={d}[i];aevalsrc='{pops}':s=44100:d={d}[p];"
          f"aevalsrc='{whoosh}':s=44100:d={d},bandpass=f=1800:w=1.5,volume=0.9[w];"
          f"aevalsrc='{ding}':s=44100:d={d}[g];"
          f"[a]lowpass=f=9000,volume=0.8[a2];[a2][i][w][g][p]amix=inputs=5:normalize=0:duration=first,"
          f"afade=t=out:st={d-0.8}:d=0.8,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100[mix]")
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', f'out/reel-{n}-silent.mp4', '-filter_complex', fc,
                    '-map', '0:v', '-map', '[mix]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', f'out/reel-{n}.mp4'], check=True)
    print('reel', n, 'ok')
