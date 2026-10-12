export interface ShareCardData {
    won: boolean;
    ending: string;
    stats: Array<[string, string]>;
    url: string;
}

const FONT = "'Press Start 2P', monospace";

// Draws a 1200x630 results card (the usual social preview size).
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

    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.font = `32px ${FONT}`;
    ctx.fillText('Discord Simulator', 80, 85);
    ctx.textAlign = 'right';
    ctx.fillStyle = data.won ? '#f0b232' : '#f23f43';
    ctx.fillText(data.won ? 'YOU WIN' : 'GAME OVER', 1120, 85);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#dbdee1';
    ctx.font = `28px ${FONT}`;
    let y = 200;
    for (const line of wrap(ctx, data.ending, 1040)) {
        ctx.fillText(line, 80, y);
        y += 48;
    }

    y = Math.max(y + 40, 340);
    for (const [label, value] of data.stats) {
        ctx.font = `22px ${FONT}`;
        ctx.fillStyle = '#949ba4';
        ctx.fillText(label, 80, y);
        ctx.fillStyle = '#fff';
        ctx.fillText(value, 480, y);
        y += 56;
    }

    ctx.font = `16px ${FONT}`;
    ctx.fillStyle = '#949ba4';
    ctx.fillText(data.url, 80, 560);
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
