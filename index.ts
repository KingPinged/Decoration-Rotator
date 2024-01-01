/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { showNotification } from "@api/Notifications";
import { definePluginSettings, Settings } from "@api/Settings";
import { localStorage } from "@utils/localStorage";
import { sleep } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { RestAPI } from "@webpack/common";

enum RotationDelay {
    Daily,
    Hourly,
    Weekly,
    // minutely WILL cause rate limit, only use for dev testing!!!
    Minutely,
}

// TODO make settings listeners so we dont need to restart all the time
const settings = definePluginSettings({
    pickRandomly: {
        type: OptionType.BOOLEAN,
        description: "Choose a random decoration from possible instead of linearly",
        restartNeeded: true,
        default: true,
    },
    includeNitro: {
        type: OptionType.BOOLEAN,
        description: "If the free nitro decorations are included",
        restartNeeded: true,
        default: true,
    },
    rotationDelay: {
        type: OptionType.SELECT,
        description: "How often to change the decoration",
        options: [
            { label: "Daily", value: RotationDelay.Daily, default: true },
            { label: "Hourly", value: RotationDelay.Hourly },
            { label: "Weekly", value: RotationDelay.Weekly },
            { label: "Minutely", value: RotationDelay.Minutely },
        ],
        restartNeeded: true,
    },
});

// i mean... better than timers
let startDate;

const retryCooldown = 6000;

// TODO : fucking learn this type shit
const decorations: [
    [
        decName: string,
        {
            avatar_decoration_id: string;
            avatar_decoration_sku_id: string;
        }
    ]
] = [] as any;

// default to first
let currIndex = 0;

let used: number[] = [];

export default definePlugin({
    name: "Decoration Rotatator",
    description: "Changes your avatar decorations automatically ( that you own )",
    authors: [
        {
            id: 372511780494114818n,
            name: "Mason",
        },
    ],
    settings,
    commands: [
        {
            name: "time left",
            description: "How much time left till next decoration rotation",
            inputType: ApplicationCommandInputType.BOT,
            async execute(args, ctx) {

                let content;
                switch (Settings.plugins["Decoration Rotatator"].rotationDelay) {
                    case RotationDelay.Daily:
                        content = (startDate - (Date.now() - 86400000)) / 60000;
                        break;
                    case RotationDelay.Hourly:
                        content = (startDate - (Date.now() - 3600000)) / 60000;
                        break;
                    case RotationDelay.Weekly:
                        content = (startDate - (Date.now() - 604800000)) / 60000;
                        break;
                    case RotationDelay.Minutely:
                        content = (startDate - (Date.now() - 60000)) / 60000;
                        break;
                }

                const hours = Math.floor(content / 60);
                const minutes = Math.floor(content % 60);
                const seconds = Math.floor((content % 1) * 60);

                return sendBotMessage(ctx.channel.id, {
                    content: `Time left: ${hours} hours, ${minutes} minutes, ${seconds} seconds`

                });


            }
        }
    ],
    async start() {
        // This settings thing is confusing
        const settings = Settings.plugins["Decoration Rotatator"];


        currIndex = Number(localStorage.getItem("currIndexDR")) || 0;
        startDate =
            Number(localStorage.getItem("startDateDecorationRotate")) || Date.now();

        let tries = 0;

        const body = await (async function () {
            while (true) {
                const { body, ok } = await RestAPI.get({
                    url: "/users/@me/collectibles-purchases",
                }).catch(console.error);

                if (ok === false) {
                    sleep(retryCooldown + tries * 3000);
                    tries = Math.min(tries + 1, 20);

                    showNotification({
                        title: "Decoration failed to change!",
                        body: "Check API status!",
                    });
                } else return body;
            }
        })();

        for (const dec of body) {
            if (settings.includeNitro === false) {
                if (dec.purchase_type === 7) continue;
            }

            decorations.push([
                dec.name,
                {
                    avatar_decoration_id: dec.items[0].id,
                    avatar_decoration_sku_id: dec.items[0].sku_id,
                },
            ]);
        }

        used = localStorage.getItem("usedArrDR") ? JSON.parse(localStorage.getItem("usedArrDR") || "[]") : new Array(decorations.length).map((val, i) => {
            return i;
        });

        // if length of used doesnt match decorations length, then we need to reset it
        if (used.length !== decorations.length) {
            used = new Array(decorations.length).map((val, i) => {
                return i;
            });
        }


        // /???? why wont it let me set to 0
        if (decorations.length === 1) {
            return await showNotification({
                title: "No decorations detected!",
                body: "Buy in shop",
            });
        }

        // 1000 ms = 1 second  60000 ms = 1 minute 3,600,000 = 1 hour 86,400,000 = 1 day 604,800,000 = 1 week  ~ calculator
        switch (settings.rotationDelay) {
            // what happens if you setTimeoutfor negative ms? then no need to conditional?
            case RotationDelay.Daily:
                if (Date.now() - 86400000 <= startDate) {
                    console.log("Waiting", (startDate - (Date.now() - 86400000)) / 60000);
                    await sleep(startDate - (Date.now() - 86400000));
                }
                break;
            case RotationDelay.Hourly:
                if (Date.now() - 3600000 <= startDate) {
                    console.log("Waiting", (startDate - (Date.now() - 3600000)) / 60000);
                    await sleep(startDate - (Date.now() - 3600000));
                }
                break;
            case RotationDelay.Weekly:
                if (Date.now() - 604800000 <= startDate) {
                    console.log(
                        "Waiting",
                        (startDate - (Date.now() - 604800000)) / 60000
                    );
                    await sleep(startDate - (Date.now() - 604800000));
                }
                break;
            case RotationDelay.Minutely:
                if (Date.now() - 60000 <= startDate) {
                    console.log("Waiting", startDate - (Date.now() - 60000));
                    await sleep(startDate - (Date.now() - 60000));
                }
                break;
        }

        await setDecoration(settings);

        logic(settings);
    },
});

/**
 * Set's the user's decoration.
 *
 * @param settings the settings of the plugin
 * @param decIndex (Optional) index of the decorations array to set
 */
async function setDecoration(settings, decIndex?) {
    console.log("Trying to set decoration", decorations, new Date());

    if (!decorations) {
        return false;
    }

    if (!decIndex) {
        if (settings.pickRandomly) {
            decIndex =
                Math.floor(Math.random() * (decorations.length - currIndex)) +
                currIndex;
            // swap the used randoms to the front where it will never be touched
            const currIndexValue = used[currIndex];
            used[currIndex] = used[decIndex];
            used[decIndex] = currIndexValue;
        } else {
            decIndex = currIndex;
        }
    }

    let tries = 0;
    while (true) {
        const { body, status, ok } = await RestAPI.patch({
            url: "/users/@me",
            body: decorations[decIndex][1] as any,
        }).catch(async e => {
            console.error(e);
            if (e.status === 400) {
                showNotification({
                    title: "Decoration failed to change!",
                    body: "You are being rate limited!",
                });

                console.log("Rate limited, waiting 300 seconds");

                await sleep(300000);

                return setDecoration(settings, decIndex);
            }
        });

        if (status === "405") {
            // remove the decoration from the list
            decorations.splice(decIndex, 1);

            console.log("Removed decoration from list", decorations);

            return setDecoration(settings);
        }

        if (ok === false) {
            sleep(retryCooldown + tries * 3000);
            tries = Math.min(tries + 1, 20);

            showNotification({
                title: "Decoration failed to change retrying!",
                body: "Check API status!",
            });
        } else break;
    }

    showNotification({
        title: "Decoration Changed!",
        body: `${decorations[currIndex][0]} -> ${decorations[decIndex][0]}`,
        icon: "", // TODO: get the decoration icon somehow,
    });

    console.log("Changed decoration to", decorations[decIndex][0]);

    currIndex++;

    if (currIndex === decorations.length) {
        currIndex = 0;
    }

    localStorage.setItem("currIndexDR", currIndex.toString());
    localStorage.setItem("usedArrDR", JSON.stringify(used));
    localStorage.setItem("startDateDecorationRotate", Date.now().toString());

    return true;
}

/**
 * The main loop logic for decoration change.
 * @param settings the settings
 */
async function logic(settings) {
    let delay;

    switch (settings.rotationDelay) {
        case RotationDelay.Daily:
            delay = 86400000;
            break;
        case RotationDelay.Hourly:
            delay = 3600000;
            break;
        case RotationDelay.Weekly:
            delay = 604800000;
            break;
        case RotationDelay.Minutely:
            delay = 60000;
            break;
    }

    while (true) {
        await sleep(delay);
        await setDecoration(settings);
    }
}
