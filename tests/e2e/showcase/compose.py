# Builds the showcase video: intro → for each chapter (title card + captioned phone recording) → outro.
import json, subprocess, sys
V = sys.argv[1]; F = float(sys.argv[2]) if len(sys.argv) > 2 else 1.3
d = json.load(open(V + '/scenes.json')); sc = d['scenes']
end = [s for s in sc if s['key'] == 'end'][0]['t']; steps = [s for s in sc if s['key'] != 'end']
run = lambda a: subprocess.run(a, check=True, cwd=V)
enc = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-preset', 'medium', '-crf', '20']
# 1. Captioned recording for the whole session (backgrounds switch per scene).
lines = []
for i, s in enumerate(steps):
    nxt = steps[i + 1]['t'] if i + 1 < len(steps) else end
    lines.append(f"file 'card-{s['key']}.png'\nduration {(nxt - s['t']) / F:.3f}")
lines.append(f"file 'card-{steps[-1]['key']}.png'")
open(V + '/bg.txt', 'w').write('\n'.join(lines) + '\n')
dur = end / F
run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'bg.txt', '-i', d['video'], '-loop', '1', '-i', 'mask.png', '-filter_complex',
     f"[0:v]fps=30,scale=1920:1080,setsar=1[bg];[1:v]setpts=PTS/{F},fps=30,crop=390:844:0:0,scale=440:952:flags=lanczos,format=rgba[ph];"
     f"[2:v]format=gray,scale=440:952[m];[ph][m]alphamerge[phr];[bg][phr]overlay=1244:60:shortest=0,trim=0:{dur:.3f}[v]",
     '-map', '[v]', *enc, 'main.mp4'])
# 2. Cut it per chapter and put a title card before each.
def still(png, secs, out):
    run(['ffmpeg', '-loglevel', 'error', '-y', '-loop', '1', '-i', png, '-t', str(secs), '-vf', f'fps=30,scale=1920:1080,setsar=1,fade=t=in:st=0:d=0.4,fade=t=out:st={secs - 0.4}:d=0.4', *enc, out])
parts = ['intro.mp4']; still('intro.png', 4, 'intro.mp4')
blocks = []
for s in steps:
    if not blocks or blocks[-1][0] != s['section']: blocks.append([s['section'], s['t']])
for i, (sec, start) in enumerate(blocks):
    stop = blocks[i + 1][1] if i + 1 < len(blocks) else end
    still(f'section-{sec}.png', 3, f'sec-{i}.mp4')
    a, b = start / F, stop / F
    run(['ffmpeg', '-loglevel', 'error', '-y', '-ss', f'{a:.3f}', '-to', f'{b:.3f}', '-i', 'main.mp4', '-vf', f'fade=t=in:st=0:d=0.3,fade=t=out:st={b - a - 0.3:.3f}:d=0.3', *enc, f'part-{i}.mp4'])
    parts += [f'sec-{i}.mp4', f'part-{i}.mp4']
still('outro.png', 5, 'outro.mp4'); parts.append('outro.mp4')
open(V + '/parts.txt', 'w').write(''.join(f"file '{p}'\n" for p in parts))
run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'parts.txt', '-c', 'copy', '-movflags', '+faststart', 'nukkadsale-showcase.mp4'])
print('done')
