import { load as loadYaml } from 'js-yaml';
import queryString from 'query-string';

import { GuiGameWindow, GuiGameWindowDefinition } from './gui/guiGame';
import { LocalizationDictionary } from './i18n/localization';
import { GameEngine, GameConfig, GameActionProxy } from './gameEngine';
import { SimpleGameTextEngine } from './gui/textEngine';
import { downloadAndParse } from './utils/network';
import { SetBuilder } from './utils/collection';
import { EndGameState } from './endGameState';
import { drawShareCard } from './gui/shareCard';

interface DebugConfig {
    dumpTranslationKeys?: boolean;
}

interface AppConfig extends GameConfig {
    guiDefinitionUrl?: string;
    languageFileUrl?: string;
    debugConfig?: DebugConfig;
}

class App {

    private _config: AppConfig;
    private _container: HTMLElement;
    private _localizer: LocalizationDictionary;
    private _gameEngine: GameEngine;
    private _actionProxy: GameActionProxy;
    private _gui?: GuiGameWindow;
    private _started: boolean = false;

    constructor(container: HTMLElement, config: AppConfig) {
        this._config = config;
        this._container = container;
        this._actionProxy = new GameActionProxy();
        this._gameEngine = new GameEngine(config, this._actionProxy);
        this._localizer = new LocalizationDictionary();
    }

    async start(): Promise<void> {
        if (this._started) {
            throw new Error('App already started!');
        }
        // The language file needs to be loaded first before rendering the game
        // GUI.
        if (this._config.languageFileUrl) {
            await this._localizer.loadFrom(this._config.languageFileUrl);
        } else {
            console.warn('Missing language file!');
        }
        const textEngine = new SimpleGameTextEngine(this._localizer,
                                                    this._gameEngine.variableStore,
                                                    this._gameEngine.random);
        if (!this._config.guiDefinitionUrl) {
            throw new Error('Missing GUI config file!');
        }
        let guiDef = await <GuiGameWindowDefinition>downloadAndParse(
            this._config.guiDefinitionUrl, loadYaml);
        let gui = new GuiGameWindow(this._container, textEngine,
                                    this._gameEngine, guiDef);
        this._actionProxy.attachGui(gui);
        this._gameEngine.onGameEnd = (sender, event) => {
            window.dispatchEvent(new CustomEvent('gameEnd', {
                detail: {
                    state: event.state,
                    endingType: event.endingType
                }
            }));
            // Fires when the ending is decided, before its message shows.
            this._showShareButton(event.state, event.endingType);
            (window as any).goatcounter?.count?.({
                path: 'ending/' + event.endingType,
                event: true
            });
        };
        await this._gameEngine.start(false);
        // Debugging info for translation keys
        if (this._config.debugConfig) {
           this._dumpDebugInfo(this._config.debugConfig);
        }
        // Start game loop
        const gameLoop = () => {
            setTimeout(() => this._gameEngine.tick().then(gameLoop), 50);
        };
        gameLoop();
        this._started = true;
    }

    private _showShareButton(state: EndGameState, endingType: string): void {
        const vars = this._gameEngine.variableStore;
        const t = (key: string) => this._localizer.translate(key);
        const num = (name: string) => (vars.getVar(name, false) ?? 0).toLocaleString('en-US');
        const ending = t('share.' + endingType);
        const text = t('share.text')
            .replace('{ending}', ending)
            .replace('{weeks}', num('elapsedWeek'))
            .replace('{members}', num('server.members'));
        const gameUrl = location.origin + location.pathname;
        const canvas = drawShareCard({
            won: state === EndGameState.Win,
            ending,
            stats: [
                [t('share.statWeeks'), num('elapsedWeek')],
                [t('share.statMembers'), num('server.members')],
                [t('share.statPeak'), Math.max(vars.getVar('server.peakMembers', false) ?? 0,
                    vars.getVar('server.members', false) ?? 0).toLocaleString('en-US')],
            ],
            lists: [
                {
                    title: t('ui.status'),
                    entries: Object.values(this._gameEngine.statusTable.items)
                        .map(([status]) => <[string, string]>[
                            t(status.unlocalizedName), '#dbdee1'
                        ])
                },
                {
                    title: t('ui.items'),
                    entries: Object.values(this._gameEngine.inventory.items)
                        .map(([item, count]) => <[string, string]>[
                            `${t(item.unlocalizedName)} x${count}`,
                            rarityColor(item.rarity)
                        ])
                },
            ],
            url: gameUrl.replace(/^https?:\/\//, ''),
        });
        const imageUrl = canvas.toDataURL('image/png');
        let file: File | undefined;
        canvas.toBlob((blob) => {
            if (blob) file = new File([blob], 'discord-simulator.png', { type: 'image/png' });
        });

        const link = document.createElement('a');
        link.className = 'btn';
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = t('ui.shareBsky');
        link.href = 'https://bsky.app/intent/compose?text=' +
            encodeURIComponent(text + ' ' + gameUrl);
        // The ending message's confirm button is added after the typewriter
        // finishes; sit next to it and leave when it does.
        const choices = document.querySelector('#message_window .choices_container')!;
        const observer = new MutationObserver(() => {
            if (!link.isConnected && choices.children.length) {
                choices.appendChild(link);
            } else if (link.isConnected && choices.children.length === 1) {
                link.remove();
                observer.disconnect();
            }
        });
        observer.observe(choices, { childList: true });
        link.onclick = (e) => {
            // Phones: the native share sheet can hand the image to the
            // Bluesky app. Elsewhere the compose intent can't carry an image,
            // so download it for manual attaching and let the link open.
            if (file && matchMedia('(pointer: coarse)').matches &&
                navigator.canShare?.({ files: [file] })) {
                e.preventDefault();
                navigator.share({ files: [file], text: text + ' ' + gameUrl })
                    .catch(() => {});
                return;
            }
            const download = document.createElement('a');
            download.href = imageUrl;
            download.download = 'discord-simulator.png';
            download.click();
        };
    }

    private _dumpDebugInfo(debugConfig: DebugConfig): void {
        if (debugConfig.dumpTranslationKeys) {
            const allEvents = this._gameEngine.eventEngine.getEvents();
            const builder = new SetBuilder<string>();
            for (let event of allEvents) {
                builder.addAll(event.collectTranslationKeys());
            }
            this._gameEngine.itemRegistry.forEach((item) => {
                this._localizer.addRequiredKey(item.unlocalizedName);
                this._localizer.addRequiredKey(item.unlocalizedDescription);
            });
            this._gameEngine.statusRegistry.forEach((status) => {
                this._localizer.addRequiredKey(status.unlocalizedName);
                this._localizer.addRequiredKey(status.unlocalizedDescription);
            })
            builder.get().forEach((key) => this._localizer.addRequiredKey(key));
            const requiredKeys = this._localizer.dumpRequiredTranslationKeys();
            console.log(`# Required translation keys (${requiredKeys.length}):\n${requiredKeys.join('\n')}`);
            const missingKeys = this._localizer.dumpMissingTranslationKeys();
            console.log(`# Missing translation keys (${missingKeys.length}):\n${missingKeys.join('\n')}`);
            const unnecessaryKeys = this._localizer.dumpUnnecessaryTranslationKeys();
            console.log(`# Unnecessary translation keys (${unnecessaryKeys.length}):\n${unnecessaryKeys.join('\n')}`);
        }
    }
}

// ponytail: mirrors raritySpecificStyles in gui.yaml and the r_* colors in
// main.css; read them from the GUI definition if rulesets start to differ.
function rarityColor(rarity: number): string {
    if (rarity >= 10) return '#f0b232';
    if (rarity >= 6) return '#c58af9';
    if (rarity >= 3) return '#23a55a';
    return '#dbdee1';
}

let appConfig: AppConfig = {};
let appConfigJson = document.getElementById('app_config')?.textContent;
if (appConfigJson) {
    appConfig = {...JSON.parse(appConfigJson)};
}
let parsedHash = queryString.parse(window.location.hash || '');
let seed = parsedHash['init_seed'];
if (typeof seed === 'string') {
    appConfig['initialRandomSeed'] = seed;
}

const app = new App(document.body, appConfig);
app.start().then(() => {
    console.log('App started successfully.');
});
