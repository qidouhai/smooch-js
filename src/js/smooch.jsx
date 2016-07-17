import { setStripeInfo, setApp } from './actions/app-actions';
import { updateText } from './actions/ui-actions';
import { resetConversation } from './actions/conversation-actions';
import { resetIntegrations } from './actions/integrations-actions';
import * as AppStateActions from './actions/app-state-actions';
import { reset } from './actions/common-actions';

import { observable, observeStore } from './utils/events';
import { getDeviceId } from './utils/device';

import { VERSION } from './constants/version';

const reactPromise = System.import('react');
const reactDomPromise = System.import('react-dom');
const pickPromise = System.import('lodash.pick');
const storePromise = System.import('./stores/app-store');
const rootPromise = System.import('./root');
const stylesheetPromise = System.import('../stylesheets/main.less');
const authServicePromise = System.import('./services/auth-service');
const authActionsPromise = System.import('./actions/auth-actions');
const userActionsPromise = System.import('./actions/user-actions');
const appServicePromise = System.import('./services/app-service');
const stripeServicePromise = System.import('./services/stripe-service');
const userServicePromise = System.import('./services/user-service');
const conversationServicePromise = System.import('./services/conversation-service');
const domUtilsPromise = System.import('./utils/dom');
const mediaUtilsPromise = System.import('./utils/media');
const soundUtilsPromise = System.import('./utils/sound');
const appUtilsPromise = System.import('./utils/app');

function renderWidget(container) {
    return Promise.all([
        reactPromise,
        reactDomPromise,
        stylesheetPromise,
        rootPromise,
        storePromise,
        domUtilsPromise
    ]).then(([React, {render}, stylesheet, {Root}, {store}, {waitForPage}]) => {
        stylesheet.use();
        if (container) {
            render(<Root store={ store } />, container);
            return container;
        } else {
            const el = document.createElement('div');
            el.setAttribute('id', 'sk-holder');
            render(<Root store={ store } />, el);

            waitForPage().then(() => {
                document.body.appendChild(el);
            });

            return el;
        }
    });
}

function renderLink() {
    return Promise.all([
        reactPromise,
        reactDomPromise,
        domUtilsPromise
    ]).then(([React, {render}, {waitForPage}]) => {

        const el = document.createElement('div');

        render(<a href='https://smooch.io/live-web-chat/?utm_source=widget'>Messaging by smooch.io</a>, el);

        waitForPage().then(() => {
            document.body.appendChild(el);
            setTimeout(() => el.className = '', 200);
        });

        return el;
    });
}

observable.on('message:sent', (message) => {
    observable.trigger('message', message);
});
observable.on('message:received', (message) => {
    observable.trigger('message', message);
});

let lastTriggeredMessageTimestamp = 0;
let initialStoreChange = true;
let unsubscribeFromStore;

function handleNotificationSound() {
    return Promise.all([storePromise, soundUtilsPromise], ([store], {playNotificationSound}) => {
        const {appState: {soundNotificationEnabled}, browser: {hasFocus}} = store.getState();

        if (soundNotificationEnabled && !hasFocus) {
            playNotificationSound();
        }
    });
}


function onStoreChange({messages, unreadCount}) {
    if (messages.length > 0) {
        if (unreadCount > 0) {
            // only handle non-user messages
            const filteredMessages = messages.filter((message) => message.role !== 'appUser');
            filteredMessages.slice(-unreadCount).filter((message) => message.received > lastTriggeredMessageTimestamp).forEach((message) => {
                observable.trigger('message:received', message);
                lastTriggeredMessageTimestamp = message.received;

                if (initialStoreChange) {
                    initialStoreChange = false;
                } else {
                    handleNotificationSound();
                }
            });
        }
    }
}

export class Smooch {
    VERSION = VERSION

    on() {
        return observable.on(...arguments);
    }

    off() {
        return observable.off(...arguments);
    }

    init(props) {
        return Promise.all([
            pickPromise,
            storePromise,
            userServicePromise,
            domUtilsPromise,
            mediaUtilsPromise,
            soundUtilsPromise
        ]).then(([pick, {store}, {EDITABLE_PROPERTIES}, {monitorBrowserState}, {isImageUploadSupported}, {isAudioSupported}]) => {
            props = {
                imageUploadEnabled: true,
                soundNotificationEnabled: true,
                ...props
            };

            if (/lebo|awle|pide|obo|rawli/i.test(navigator.userAgent)) {
                observable.trigger('ready');
                return renderLink();
            } else if (/PhantomJS/.test(navigator.userAgent) && process.env.NODE_ENV !== 'test') {
                return Promise.resolve();
            }

            this.appToken = props.appToken;

            if (props.emailCaptureEnabled) {
                store.dispatch(AppStateActions.enableEmailCapture());
            } else {
                store.dispatch(AppStateActions.disableEmailCapture());
            }

            if (props.soundNotificationEnabled && isAudioSupported()) {
                store.dispatch(AppStateActions.enableSoundNotification());
            } else {
                store.dispatch(AppStateActions.disableSoundNotification());
            }

            if (props.imageUploadEnabled && isImageUploadSupported()) {
                store.dispatch(AppStateActions.enableImageUpload());
            } else {
                store.dispatch(AppStateActions.disableImageUpload());
            }

            store.dispatch(AppStateActions.setEmbedded(!!props.embedded));

            if (props.customText) {
                store.dispatch(updateText(props.customText));
            }

            if (props.serviceUrl) {
                store.dispatch(AppStateActions.setServerURL(props.serviceUrl));
            }
            unsubscribeFromStore = observeStore(store, ({conversation}) => conversation, onStoreChange);

            monitorBrowserState();
            return this.login(props.userId, props.jwt, pick(props, EDITABLE_PROPERTIES));
        });
    }

    login(userId = '', jwt, attributes) {
        return Promise.all([
            pickPromise,
            storePromise,
            authServicePromise,
            authActionsPromise,
            userActionsPromise,
            appServicePromise,
            stripeServicePromise,
            userServicePromise,
            conversationServicePromise,
            domUtilsPromise,
            appUtilsPromise
        ]).then(([pick, {store}, {login}, {setAuth, resetAuth}, userActions, {hideSettings, hideChannelPage}, {getAccount}, {EDITABLE_PROPERTIES, updateNowViewing, immediateUpdate: immediateUpdateUser}, {getConversation, connectFayeConversation, disconnectFaye}, {monitorUrlChanges}, {getIntegration, hasChannels}]) => {
            if (arguments.length === 2 && typeof jwt === 'object') {
                attributes = jwt;
                jwt = undefined;
            } else if (arguments.length < 3) {
                attributes = {};
            }

            // in case those are opened;
            hideSettings();
            hideChannelPage();

            // in case it comes from a previous authenticated state
            store.dispatch(resetAuth());
            store.dispatch(userActions.resetUser());
            store.dispatch(resetConversation());
            store.dispatch(resetIntegrations());

            disconnectFaye();

            attributes = pick(attributes, EDITABLE_PROPERTIES);

            if (store.getState().appState.emailCaptureEnabled && attributes.email) {
                store.dispatch(AppStateActions.setEmailReadonly());
            } else {
                store.dispatch(AppStateActions.unsetEmailReadonly());
            }

            store.dispatch(setAuth({
                jwt: jwt,
                appToken: this.appToken
            }));

            lastTriggeredMessageTimestamp = 0;
            initialStoreChange = true;

            return login({
                userId: userId,
                device: {
                    platform: 'web',
                    id: getDeviceId(),
                    info: {
                        sdkVersion: VERSION,
                        URL: document.location.host,
                        userAgent: navigator.userAgent,
                        referrer: document.referrer,
                        browserLanguage: navigator.language,
                        currentUrl: document.location.href,
                        currentTitle: document.title
                    }
                }
            }).then((loginResponse) => {
                store.dispatch(userActions.setUser(loginResponse.appUser));
                store.dispatch(setApp(loginResponse.app));

                monitorUrlChanges(() => {
                    updateNowViewing(getDeviceId());
                });

                if (hasChannels(loginResponse.app.settings.web)) {
                    store.dispatch(AppStateActions.disableEmailCapture());
                }

                if (getIntegration(loginResponse.app.integrations, 'stripeConnect')) {
                    return getAccount().then((r) => {
                        store.dispatch(setStripeInfo(r.account));
                    }).catch(() => {
                        // do nothing about it and let the flow continue
                    });
                }
            }).then(() => {
                return immediateUpdateUser(attributes).then(() => {
                    const user = store.getState().user;
                    if (user.conversationStarted) {
                        return getConversation().then(connectFayeConversation);
                    }
                });
            }).then(() => {
                if (!store.getState().appState.embedded) {
                    if (!this._container) {
                        return this.render().then((el) => this._container = el);
                    }
                }
            }).then(() => {
                const user = store.getState().user;
                observable.trigger('ready', user);
                return user;
            });
        });
    }

    logout() {
        return this.login();
    }

    track(eventName, userProps) {
        return userServicePromise.then(({trackEvent}) => {
            return trackEvent(eventName, userProps);
        });
    }

    sendMessage(text) {
        return conversationServicePromise.then(({sendMessage}) => {
            return sendMessage(text);
        });
    }

    updateUser(props) {
        return Promise.all([userServicePromise, conversationServicePromise]).then(([update, {handleConversationUpdated}]) => {
            return update(props).then((response) => {
                if (response.appUser.conversationStarted) {
                    return handleConversationUpdated().then(() => {
                        return response;
                    });
                }

                return response;
            });
        });
    }

    getConversation() {
        return Promise.all([storePromise, userActionsPromise, conversationServicePromise])
            .then(([{store}, userActions, {handleConversationUpdated}]) => {
                return handleConversationUpdated().then(() => {
                    store.dispatch(userActions.updateUser({
                        conversationStarted: true
                    }));
                    return store.getState().conversation;
                });
            });
    }

    destroy() {
        if (!this.appToken) {
            console.warn('Smooch.destroy was called before Smooch.init was called properly.');
        }
        return Promise.all([
            reactDomPromise,
            storePromise,
            conversationServicePromise
        ]).then(([{unmountComponentAtNode}, store, {disconnectFaye}, {stopMonitoringUrlChanges, stopMonitoringBrowserState}]) => {

            stopMonitoringBrowserState();

            if (process.env.NODE_ENV !== 'test' && this._container) {
                unmountComponentAtNode(this._container);
            }

            const {embedded} = store.getState().appState;
            disconnectFaye();
            store.dispatch(reset());

            if (embedded) {
                // retain the embed mode
                store.dispatch(AppStateActions.setEmbedded(true));
            } else if (this._container) {
                document.body.removeChild(this._container);
            }

            stopMonitoringUrlChanges();
            unsubscribeFromStore();

            delete this.appToken;
            delete this._container;
            observable.trigger('destroy');
            observable.off();

            return stylesheetPromise.then((stylesheet) => {
                stylesheet.unuse();
            });
        });
    }

    open() {
        return appServicePromise.then(({openWidget}) => {
            openWidget();
        });
    }

    close() {
        return appServicePromise.then(({closeWidget}) => {
            closeWidget();
        });
    }

    isOpened() {
        return storePromise.then((store) => !!store.getState().appState.widgetOpened);
    }

    render(container) {
        this._container = container;
        return renderWidget(container);
    }
}
