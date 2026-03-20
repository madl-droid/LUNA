// utils.js — Shared utility functions

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function setStatus(text, cls) {
  const el = document.getElementById('status')
  el.textContent = text
  el.className = 'status-text ' + (cls || '')
}

function showToast(msg, type) {
  const old = document.querySelector('.toast')
  if (old) old.remove()
  const el = document.createElement('div')
  el.className = 'toast ' + type
  el.textContent = msg
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 3500)
}
