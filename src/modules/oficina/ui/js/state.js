// state.js — Global application state

let originalValues = {}
let currentValues = {}
let allModels = { anthropic: [], gemini: [] }
let waState = { status: 'not_initialized', qrDataUrl: null, lastDisconnectReason: null, moduleEnabled: false }
let waPolling = null
let lastScan = null
let moduleStates = []
let _pendingApply = false
