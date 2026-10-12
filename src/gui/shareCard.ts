export interface ShareCardData {
    won: boolean;
    ending: string;
    stats: Array<[string, string]>;
    lists: Array<{ title: string, entries: Array<[string, string]> }>;
    url: string;
}

const FONT = "'Press Start 2P', monospace";
const BOTTOM = 540;

// Draws a 1200x630 results card (the usual social preview size): ending and
// stats on the left, lists (inventory, statuses) on the right.
export function drawShareCard(data: ShareCardData): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#1e1f22';
    ctx.fillRect(0, 0, 1200, 630);
    ctx.fillStyle = '#313338';
    ctx.fillRect(40, 40, 1120, 550);
    ctx.fillStyle = '#5865f2';
    ctx.fillRect(40, 40, 1120, 90);
    ctx.fillStyle = '#1e1f22';
    ctx.fillRect(620, 130, 4, 460);

    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.font = `32px ${FONT}`;
    ctx.fillText('Discord Simulator', 80, 85);
    ctx.textAlign = 'right';
    ctx.fillStyle = data.won ? '#f0b232' : '#f23f43';
    ctx.fillText(data.won ? 'YOU WIN' : 'GAME OVER', 1120, 85);
    ctx.textAlign = 'left';

    // Left column
    ctx.fillStyle = '#dbdee1';
    ctx.font = `24px ${FONT}`;
    let y = 180;
    for (const line of wrap(ctx, data.ending, 500)) {
        ctx.fillText(line, 80, y);
        y += 40;
    }
    y = Math.max(y + 30, 300);
    for (const [label, value] of data.stats) {
        ctx.font = `18px ${FONT}`;
        ctx.fillStyle = '#949ba4';
        ctx.fillText(label, 80, y);
        ctx.fillStyle = '#fff';
        ctx.font = `22px ${FONT}`;
        ctx.fillText(value, 80, y + 30);
        y += 66;
    }
    ctx.font = `16px ${FONT}`;
    ctx.fillStyle = '#949ba4';
    ctx.fillText(data.url, 80, 560);

    // Right column
    y = 180;
    for (const list of data.lists) {
        if (y > BOTTOM - 30) break;
        ctx.font = `20px ${FONT}`;
        ctx.fillStyle = '#fff';
        ctx.fillText(list.title, 660, y);
        y += 40;
        ctx.font = `18px ${FONT}`;
        const entries = list.entries.length ? list.entries : [['-', '#949ba4']];
        for (let i = 0; i < entries.length; i++) {
            // Leave the last line for "+N more" if everything won't fit.
            if (y + 30 > BOTTOM && i < entries.length - 1) {
                ctx.fillStyle = '#949ba4';
                ctx.fillText(`+${entries.length - i} more`, 680, y);
                y += 30;
                break;
            }
            ctx.fillStyle = entries[i][1];
            ctx.fillText(entries[i][0], 680, y, 440);
            y += 30;
        }
        y += 24;
    }
    return canvas;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
        const next = line ? line + ' ' + word : word;
        if (line && ctx.measureText(next).width > width) {
            lines.push(line);
            line = word;
        } else {
            line = next;
        }
    }
    lines.push(line);
    return lines;
}
