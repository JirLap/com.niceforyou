'use strict';

const {ZwaveDevice} = require('homey-zwavedriver');

const STATE_OPEN = 'open';
const STATE_CLOSED = 'closed';
const STATE_OPENING = 'opening';
const STATE_CLOSING = 'closing';
const STATE_STOPPED = 'stopped';

const GATE_STATE = {
    0: STATE_CLOSED,
    198: STATE_OPEN,
    254: STATE_CLOSING,
    353: STATE_OPENING,
    508: STATE_STOPPED,
}

const LIST_STATES_OPENING = [
    STATE_OPEN, STATE_OPENING,
]

const LIST_STATES_CLOSING = [
    STATE_CLOSING, STATE_CLOSED,
]

const OBSTACLE_SOURCE = {
    71: 'engine',
    72: 'beam',
    76: 'external',
}

class BusT4Device extends ZwaveDevice {

    async onNodeInit(node) {
        this.log('BusT4Device has been inited');
        this.enableDebug();

        // Open/close the gate
        this.registerCapability('onoff', 'SWITCH_MULTILEVEL', {
            setParserV4: this._gateSetParser.bind(this),
            reportParser: this._gateReportParser.bind(this),
            reportParserOverride: true,
        });

        // Notification listener
        this.registerReportListener('NOTIFICATION', 'NOTIFICATION_REPORT', report => {
            this.log('Notification received', report);

            if (report && report.hasOwnProperty('Event') && Object.keys(OBSTACLE_SOURCE).includes(report.Event.toString())) {
                this.setNotification(OBSTACLE_SOURCE[report.Event]);
            }
        });

        // Set capabilities from current state
        this.setNotification(null, true);

        // Refresh state, so we know what we are up to
        this.refreshCapabilityValue('onoff', 'SWITCH_MULTILEVEL').catch(
            err => this.log('Refresh ON/OFF failed', err)
        );
    }

    /**
     * Set state capability and trigger flows
     * @param {string} state
     * @param {boolean} silent
     */
    setState(state, silent = false) {
        // State is same, as what we want set
        if (this.getCapabilityValue('state') === state) {
            return;
        }

        this.setCapabilityValue('state', state).catch(
            err => this.log(`Could not set capability value for state`, err)
        )

        // Reset notification on closing/closed
        if (LIST_STATES_CLOSING.includes(state)) {
            this.setNotification(null);
        }

        // If no silent mode for init, trigger
        if (!silent) {
            this.getDriver().stateChangedTrigger.trigger(this, {state: state});
        }
    }

    /**
     * Set notification capability and trigger flows
     * @param {string|null} notification
     * @param {boolean} silent
     */
    setNotification(notification, silent = false) {
        // Notification is already there
        if (this.getCapabilityValue('notification') === notification) {
            return;
        }

        this.setCapabilityValue('notification', notification).catch(
            err => this.log(`Could not set capability value for notification`, err)
        )

        // If notification is set, and no silent mode for init, trigger
        if (notification !== null && !silent) {
            this.getDriver().notificationReceivedTrigger.trigger(this, {notification: notification});
        }
    }

    /**
     * Set parser
     * @param value
     * @returns {{"Dimming Duration": string, Value: (string)}}
     * @private
     */
    _gateSetParser(value) {
        this.log('Set parser', value);

        const state = this.getCapabilityValue('state');
        const isOpeningState = LIST_STATES_OPENING.includes(state);
        const isClosingState = LIST_STATES_CLOSING.includes(state);

        if ((value && !isOpeningState) || (!value && !isClosingState)) {
            this.setState(value ? STATE_OPEN : STATE_CLOSED);
        }

        return {
            Value: value ? 'on/enable' : 'off/disable',
            'Dimming Duration': 'Default',
        };
    }

    /**
     * Report parser for state detection
     * @param report
     * @private
     */
    _gateReportParser(report) {
        this.log('Gate report received', report);

        if (report
            && report.hasOwnProperty('Current Value (Raw)')
            && report.hasOwnProperty('Target Value (Raw)')
        ) {
            // Read value from RAW (parsed is wrong time to time)
            const currentValue = report['Current Value (Raw)'].readUInt8();
            const targetValue = report['Target Value (Raw)'].readUInt8();

            // Calculate stateCode and stateText
            const stateCode = currentValue + targetValue;
            const stateText = GATE_STATE[stateCode];

            this.log(`Gate status ${stateCode}, parsed: ${stateText}`);

            // Change state only if real change occur
            this.setState(stateText);

            return stateCode !== 0;
        }
    }
}

module.exports = BusT4Device;
