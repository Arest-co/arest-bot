// ═══════════════════════════════════════════════════════════
//  arset — Bot de WhatsApp para comunidades
//  Solo responde a mensajes que empiezan con "/"
//  Vinculación con código de emparejamiento (pairing code)
// ═══════════════════════════════════════════════════════════
import * as baileysNs from '@whiskeysockets/baileys'
import pino from 'pino'
import readline from 'node:readline'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { Sticker, StickerTypes } from 'wa-sticker-formatter'

// Compatibilidad con Baileys 6.x (CJS) y 7.x (ESM)
const B = baileysNs.default?.useMultiFileAuthState ? baileysNs.default : baileysNs
const makeWASocket = typeof B.default === 'function' ? B.default : B.makeWASocket
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage, Browsers } = B

// ───────────── Configuración ─────────────
const CONFIG = {
  name: process.env.BOT_NAME || 'arset',
  prefix: '/',
  author: 'astre.origin.CO',
  // Números dueños (solo dígitos, separados por coma). Ej: OWNERS=5493541234567
  owners: (process.env.OWNERS || '').split(',').map(s => s.trim()).filter(Boolean),
  maxWarns: 3,
  cooldownMs: 1500,
}

// ───────────── Utilidades ─────────────
const log = pino({ level: 'silent' })
const num = j => String(j || '').split('@')[0].split(':')[0]
const mention = j => '@' + num(j)
const ask = q => new Promise(res => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  rl.question(q, a => { rl.close(); res(a.trim()) })
})
const pick = arr => arr[Math.floor(Math.random() * arr.length)]

// ───────────── Base de datos simple (JSON) ─────────────
const DB_FILE = './db.json'
let db = { groups: {} }
try { if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) } catch { /* db nueva */ }
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2))
const G = jid => (db.groups[jid] ??= { welcome: true, welcomeMsg: '', antilink: false, rules: '', warns: {} })

// ───────────── Helpers de mensajes ─────────────
function unwrap(msg) {
  let m = msg
  for (let i = 0; i < 4; i++) {
    const n = m?.ephemeralMessage?.message || m?.viewOnceMessage?.message || m?.viewOnceMessageV2?.message ||
      m?.documentWithCaptionMessage?.message
    if (!n) break
    m = n
  }
  return m
}
const getText = m => m?.conversation || m?.extendedTextMessage?.text || m?.imageMessage?.caption || m?.videoMessage?.caption || ''
const getCtx = m => {
  const t = m && Object.values(m).find(v => v && typeof v === 'object' && v.contextInfo)
  return t?.contextInfo || {}
}

// ───────────── Permisos de grupo ─────────────
const pIds = p => [p.id, p.lid, p.phoneNumber].filter(Boolean).map(num)
const isAdminOf = (meta, jid) => !!jid && meta.participants.some(p => p.admin && pIds(p).includes(num(jid)))
const botIdList = sock => [sock.user?.id, sock.user?.lid].filter(Boolean)

// ───────────── Registro de comandos ─────────────
const commands = new Map()
function cmd(names, opts, run) {
  const arr = [].concat(names)
  const c = { name: arr[0], ...opts, run }
  arr.forEach(n => commands.set(n, c))
}

// ═════════════ GENERAL ═════════════
cmd(['menu', 'help', 'ayuda'], { cat: '📋 General', desc: 'Muestra este menú' }, async c => {
  const cats = {}
  for (const x of new Set(commands.values())) if (!x.hidden) (cats[x.cat] ??= []).push(x)
  let out = `╭─〔 🤖 *${CONFIG.name}* 〕\n│ Prefijo: *${CONFIG.prefix}*\n│ Solo respondo a comandos\n╰────────────\n`
  for (const [cat, list] of Object.entries(cats)) {
    out += `\n*${cat}*\n` + list.map(x => `› ${CONFIG.prefix}${x.name}${x.usage ? ' ' + x.usage : ''} — ${x.desc}`).join('\n') + '\n'
  }
  out += `\n*🌸 Anime (gifs)*\nCon @user o respondiendo: ${Object.keys(INTERACTIVE).map(n => CONFIG.prefix + n).join(' ')}\nSolos: ${Object.keys(SOLO).map(n => CONFIG.prefix + n).join(' ')}\n`
  await c.reply(out.trim())
})

cmd('ping', { cat: '📋 General', desc: 'Latencia del bot' }, async c => {
  const ms = Math.max(0, Date.now() - Number(c.m.messageTimestamp) * 1000)
  await c.reply(`🏓 Pong! ~${ms} ms`)
})

cmd('info', { cat: '📋 General', desc: 'Información del bot' }, async c => {
  const s = Math.floor(process.uptime())
  const up = `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`
  await c.reply(`🤖 *${CONFIG.name}*\n⏱️ Activo: ${up}\n🟢 Node ${process.version}\n🏢 ${CONFIG.author}`)
})

cmd('reglas', { cat: '📋 General', desc: 'Muestra las reglas del grupo', group: true }, async c => {
  const r = G(c.chat).rules
  await c.reply(r ? `📜 *Reglas de ${c.meta.subject}*\n\n${r}` : 'Este grupo aún no tiene reglas. Un admin puede usar /setreglas.')
})

cmd('admins', { cat: '📋 General', desc: 'Lista a los admins', group: true }, async c => {
  const ad = c.meta.participants.filter(p => p.admin)
  await c.reply('👑 *Admins del grupo*\n\n' + ad.map(p => '• ' + mention(p.id)).join('\n'), ad.map(p => p.id))
})

// ═════════════ UTILIDADES ═════════════
cmd(['sticker', 's'], { cat: '🛠️ Utilidades', desc: 'Convierte imagen/video en sticker (responde o envía con el comando)' }, async c => {
  const buf = await getMedia(c)
  if (!buf) return c.reply('Envía o responde a una imagen/video con /sticker')
  const st = new Sticker(buf, { pack: CONFIG.name, author: CONFIG.author, type: StickerTypes.FULL, quality: 60 })
  await c.sock.sendMessage(c.chat, { sticker: await st.toBuffer() }, { quoted: c.m })
})

cmd('calc', { cat: '🛠️ Utilidades', desc: 'Calculadora', usage: '2+2*5' }, async c => {
  const expr = c.args
  if (!expr || !/^[\d+\-*/().%^\s,]+$/.test(expr)) return c.reply('Uso: /calc 12*(3+4)  (solo números y + - * / ( ) % ^)')
  try {
    const r = Function(`"use strict"; return (${expr.replace(/\^/g, '**').replace(/,/g, '.')})`)()
    if (typeof r !== 'number' || !Number.isFinite(r)) throw new Error('inválido')
    await c.reply(`🧮 ${expr} = *${r}*`)
  } catch { await c.reply('No pude calcular eso.') }
})

cmd('encuesta', { cat: '🛠️ Utilidades', desc: 'Crea una encuesta', usage: 'Pregunta | op1 | op2', group: true }, async c => {
  const parts = c.args.split('|').map(s => s.trim()).filter(Boolean)
  if (parts.length < 3) return c.reply('Uso: /encuesta ¿Pizza o hamburguesa? | Pizza | Hamburguesa')
  const [name, ...values] = parts
  await c.sock.sendMessage(c.chat, { poll: { name, values: values.slice(0, 12), selectableCount: 1 } })
})

cmd('elegir', { cat: '🛠️ Utilidades', desc: 'Elige entre opciones', usage: 'a | b | c' }, async c => {
  const o = c.args.split('|').map(s => s.trim()).filter(Boolean)
  if (o.length < 2) return c.reply('Uso: /elegir pizza | tacos | sushi')
  await c.reply(`🎯 Elijo: *${pick(o)}*`)
})

// ═════════════ DIVERSIÓN ═════════════
cmd('dado', { cat: '🎲 Diversión', desc: 'Lanza un dado', usage: '[caras]' }, async c => {
  const n = Math.min(Math.max(parseInt(c.args) || 6, 2), 1000)
  await c.reply(`🎲 d${n}: *${1 + Math.floor(Math.random() * n)}*`)
})

cmd('moneda', { cat: '🎲 Diversión', desc: 'Cara o cruz' }, async c => {
  await c.reply(`🪙 *${pick(['Cara', 'Cruz'])}*`)
})

cmd('8ball', { cat: '🎲 Diversión', desc: 'Pregúntale a la bola mágica', usage: 'pregunta' }, async c => {
  if (!c.args) return c.reply('Hazme una pregunta: /8ball ¿Hoy será un buen día?')
  await c.reply('🎱 ' + pick(['Sí, sin duda.', 'Todo apunta a que sí.', 'Probablemente.', 'No lo veo claro.', 'Pregunta más tarde.',
    'Mejor no te lo digo ahora.', 'No cuentes con ello.', 'Mis fuentes dicen que no.', 'Definitivamente no.']))
})

cmd('sorteo', { cat: '🎲 Diversión', desc: 'Sortea entre los miembros', group: true }, async c => {
  const bots = botIdList(c.sock).map(num)
  const pool = c.meta.participants.filter(p => !pIds(p).some(i => bots.includes(i)))
  if (!pool.length) return c.reply('No hay a quién sortear.')
  const w = pick(pool)
  await c.reply(`🎉 El ganador es... ${mention(w.id)} 🏆`, [w.id])
})

// ═════════════ DESCARGAS (YouTube) ═════════════
// Requiere yt-dlp y ffmpeg instalados en el equipo donde corre el bot
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp'
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
let busy = 0
const exec = (bin, args) => new Promise((res, rej) =>
  execFile(bin, args, { timeout: 240000, maxBuffer: 20 * 1024 * 1024 }, (e, out, err) =>
    e ? rej(Object.assign(e, { stderr: String(err || '') })) : res(String(out))))

async function ytDownload(query, kind) {
  const isUrl = /^https?:\/\/\S+$/i.test(query)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arset-'))
  try {
    const args = [
      '--no-playlist', '--no-warnings', '--match-filter', 'duration<=900', '--max-filesize', '60M',
      '-o', path.join(dir, 'out.%(ext)s'), '--print', 'title', '--no-simulate',
      ...(kind === 'audio'
        ? ['-x', '--audio-format', 'mp3', '--audio-quality', '5']
        : ['-f', 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b[height<=720]/b', '--merge-output-format', 'mp4']),
      isUrl ? query : 'ytsearch1:' + query,
    ]
    const out = await exec(YTDLP, args)
    const file = fs.readdirSync(dir).find(f => f.startsWith('out.'))
    if (!file) throw new Error('NOT_FOUND')
    return { title: out.trim().split('\n')[0] || 'archivo', buf: fs.readFileSync(path.join(dir, file)) }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

async function ytCommand(c, kind) {
  const name = kind === 'audio' ? 'ytaudio' : 'ytvideo'
  if (!c.args) return c.reply(`Uso: /${name} nombre de la canción o link de YouTube`)
  if (busy >= 2) return c.reply('⏳ Estoy ocupado con otras descargas, intenta en un momento.')
  busy++
  try {
    await c.reply(kind === 'audio' ? '🎧 Buscando y descargando audio…' : '🎬 Buscando y descargando video…')
    const { title, buf } = await ytDownload(c.args, kind)
    if (kind === 'audio') {
      await c.reply('🎵 ' + title)
      await c.sock.sendMessage(c.chat, { audio: buf, mimetype: 'audio/mpeg', fileName: title + '.mp3' }, { quoted: c.m })
    } else {
      await c.sock.sendMessage(c.chat, { video: buf, mimetype: 'video/mp4', caption: '🎬 ' + title }, { quoted: c.m })
    }
  } catch (e) {
    if (e.code === 'ENOENT') await c.reply('⚠️ Falta instalar *yt-dlp* y *ffmpeg* en el equipo donde corre el bot.')
    else if (e.message === 'NOT_FOUND' || /filter|filesize|larger/i.test(e.stderr || '')) await c.reply('😕 No encontré resultado, o dura más de 15 min / pesa más de 60 MB.')
    else { console.error('yt-dlp:', e.stderr || e.message); await c.reply('❌ No pude descargarlo. Prueba con otro nombre o link.') }
  } finally { busy-- }
}

cmd(['ytaudio', 'play', 'mp3'], { cat: '⬇️ Descargas', desc: 'Audio de YouTube (nombre o link, máx. 15 min)', usage: 'canción|link' }, c => ytCommand(c, 'audio'))
cmd(['ytvideo', 'video'], { cat: '⬇️ Descargas', desc: 'Video de YouTube en 720p (nombre o link, máx. 15 min)', usage: 'título|link' }, c => ytCommand(c, 'video'))

// ═════════════ ANIME (nekos.best + waifu.pics, sin API key) ═════════════
// [nekos.best, waifu.pics, texto, texto con @user]
const INTERACTIVE = {
  pat: ['pat', 'pat', 'acaricia la cabeza de'],
  hug: ['hug', 'hug', 'abraza a'],
  kiss: ['kiss', 'kiss', 'besa a'],
  cuddle: ['cuddle', 'cuddle', 'acurruca a'],
  slap: ['slap', 'slap', 'abofetea a'],
  poke: ['poke', 'poke', 'molesta a'],
  bite: ['bite', 'bite', 'muerde a'],
  punch: ['punch', null, 'golpea a'],
  kick: ['kick', 'kick', 'patea a'],
  tickle: ['tickle', null, 'le hace cosquillas a'],
  highfive: ['highfive', 'highfive', 'choca los cinco con'],
  handhold: ['handhold', 'handhold', 'toma de la mano a'],
  feed: ['feed', null, 'le da de comer a'],
  yeet: ['yeet', 'yeet', 'lanza por los aires a'],
  bonk: [null, 'bonk', 'le da un bonk a'],
  lick: [null, 'lick', 'lame a'],
  glomp: [null, 'glomp', 'se lanza a abrazar a'],
}
const SOLO = {
  cry: ['cry', 'cry', 'está llorando 😢'],
  dance: ['dance', 'dance', 'está bailando 💃'],
  laugh: ['laugh', null, 'se ríe 😂'],
  blush: ['blush', 'blush', 'se sonrojó 😳', 'se sonroja con'],
  smile: ['smile', 'smile', 'sonríe 😊', 'le sonríe a'],
  happy: ['happy', 'happy', 'está feliz 🥰'],
  bored: ['bored', null, 'está aburrido/a 😑'],
  sleep: ['sleep', null, 'se quedó dormido/a 😴'],
  pout: ['pout', null, 'hace pucheros 😤'],
  smug: ['smug', 'smug', 'tiene cara de superioridad 😏'],
  think: ['think', null, 'está pensando 🤔'],
  nom: ['nom', 'nom', 'está comiendo 😋'],
  wave: ['wave', 'wave', 'saluda 👋', 'saluda a'],
  wink: ['wink', 'wink', 'guiña el ojo 😉', 'le guiña el ojo a'],
  facepalm: ['facepalm', null, 'se hizo un facepalm 🤦'],
  shrug: ['shrug', null, 'se encoge de hombros 🤷'],
  stare: ['stare', null, 'se queda mirando fijamente 👀', 'mira fijamente a'],
  baka: ['baka', null, 'dice baka 💢', 'le dice baka a'],
  thumbsup: ['thumbsup', null, 'levanta el pulgar 👍'],
  cringe: [null, 'cringe', 'siente cringe 😬'],
}

async function fetchAnimeGif(nb, wp) {
  const sources = []
  if (nb) sources.push(async () => (await (await fetch('https://nekos.best/api/v2/' + nb, { signal: AbortSignal.timeout(15000) })).json())?.results?.[0]?.url)
  if (wp) sources.push(async () => (await (await fetch('https://api.waifu.pics/sfw/' + wp, { signal: AbortSignal.timeout(15000) })).json())?.url)
  for (const get of sources) { try { const u = await get(); if (u) return u } catch { /* siguiente API */ } }
  return null
}

async function animeAction(c, nb, wp, caption, mentions) {
  const url = await fetchAnimeGif(nb, wp)
  if (!url) return c.reply('😿 No pude conseguir el gif ahora, intenta de nuevo en un momento.')
  const gif = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(20000) })).arrayBuffer())
  // WhatsApp reproduce los "gif" como mp4: se convierte con ffmpeg
  let mp4 = null
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arset-'))
  try {
    fs.writeFileSync(path.join(dir, 'in.gif'), gif)
    await exec(FFMPEG, ['-y', '-i', path.join(dir, 'in.gif'), '-movflags', 'faststart', '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-an', path.join(dir, 'out.mp4')])
    mp4 = fs.readFileSync(path.join(dir, 'out.mp4'))
  } catch { /* sin ffmpeg: se usa sticker animado */ } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  if (mp4) return c.sock.sendMessage(c.chat, { video: mp4, gifPlayback: true, caption, mentions }, { quoted: c.m })
  await c.reply(caption, mentions)
  const st = new Sticker(gif, { pack: CONFIG.name, author: CONFIG.author, type: StickerTypes.FULL, quality: 50 })
  await c.sock.sendMessage(c.chat, { sticker: await st.toBuffer() })
}

for (const [name, [nb, wp, verb]] of Object.entries(INTERACTIVE)) {
  cmd(name, { cat: '🌸 Anime', hidden: true, desc: 'Gif de anime' }, async c => {
    if (!c.target) return c.reply(`Menciona a alguien o responde a su mensaje: /${name} @user`)
    await animeAction(c, nb, wp, `${mention(c.sender)} ${verb} ${mention(c.target)}`, [c.sender, c.target])
  })
}
for (const [name, [nb, wp, verb, verbTarget]] of Object.entries(SOLO)) {
  cmd(name, { cat: '🌸 Anime', hidden: true, desc: 'Gif de anime' }, async c => {
    const withTarget = c.target && verbTarget
    await animeAction(c, nb, wp,
      withTarget ? `${mention(c.sender)} ${verbTarget} ${mention(c.target)}` : `${mention(c.sender)} ${verb}`,
      withTarget ? [c.sender, c.target] : [c.sender])
  })
}

for (const name of ['waifu', 'neko']) {
  cmd(name, { cat: '🌸 Anime (imágenes)', desc: `Imagen de anime: ${name}` }, async c => {
    try {
      const j = await (await fetch('https://api.waifu.pics/sfw/' + name, { signal: AbortSignal.timeout(15000) })).json()
      await c.sock.sendMessage(c.chat, { image: { url: j.url }, caption: '✨ ' + name }, { quoted: c.m })
    } catch { await c.reply('😿 No pude conseguir la imagen ahora, intenta de nuevo.') }
  })
}

// ═════════════ MODERACIÓN / ADMIN ═════════════
cmd(['todos', 'tagall'], { cat: '👥 Comunidad', desc: 'Menciona a todos', usage: '[mensaje]', group: true, admin: true }, async c => {
  const ids = c.meta.participants.map(p => p.id)
  const txt = `📢 *${c.args || 'Atención a todos'}*\n\n` + ids.map(j => '• ' + mention(j)).join('\n')
  await c.reply(txt, ids)
})

cmd(['ocultar', 'hidetag'], { cat: '👥 Comunidad', desc: 'Menciona a todos sin mostrar la lista', usage: 'mensaje', group: true, admin: true }, async c => {
  if (!c.args) return c.reply('Uso: /ocultar tu mensaje')
  await c.sock.sendMessage(c.chat, { text: c.args, mentions: c.meta.participants.map(p => p.id) })
})

cmd(['kick', 'expulsar'], { cat: '🛡️ Admin', desc: 'Expulsa a alguien', usage: '@user', group: true, admin: true, botAdmin: true }, async c => {
  if (!c.target) return c.reply('Menciona o responde al mensaje de quien quieres expulsar.')
  if (isAdminOf(c.meta, c.target)) return c.reply('No puedo expulsar a un admin.')
  await c.sock.groupParticipantsUpdate(c.chat, [c.target], 'remove')
  await c.reply(`👢 ${mention(c.target)} fue expulsado.`, [c.target])
})

cmd(['promover', 'daradmin'], { cat: '🛡️ Admin', desc: 'Da admin a alguien', usage: '@user', group: true, admin: true, botAdmin: true }, async c => {
  if (!c.target) return c.reply('Menciona o responde al mensaje de la persona.')
  await c.sock.groupParticipantsUpdate(c.chat, [c.target], 'promote')
  await c.reply(`⬆️ ${mention(c.target)} ahora es admin.`, [c.target])
})

cmd(['degradar', 'quitaradmin'], { cat: '🛡️ Admin', desc: 'Quita admin a alguien', usage: '@user', group: true, admin: true, botAdmin: true }, async c => {
  if (!c.target) return c.reply('Menciona o responde al mensaje de la persona.')
  await c.sock.groupParticipantsUpdate(c.chat, [c.target], 'demote')
  await c.reply(`⬇️ ${mention(c.target)} ya no es admin.`, [c.target])
})

cmd('grupo', { cat: '🛡️ Admin', desc: 'Abre o cierra el grupo', usage: 'abrir|cerrar', group: true, admin: true, botAdmin: true }, async c => {
  const a = c.args.toLowerCase()
  if (a === 'cerrar') { await c.sock.groupSettingUpdate(c.chat, 'announcement'); return c.reply('🔒 Grupo cerrado: solo admins pueden escribir.') }
  if (a === 'abrir') { await c.sock.groupSettingUpdate(c.chat, 'not_announcement'); return c.reply('🔓 Grupo abierto: todos pueden escribir.') }
  await c.reply('Uso: /grupo abrir  o  /grupo cerrar')
})

cmd('link', { cat: '🛡️ Admin', desc: 'Link de invitación del grupo', group: true, admin: true, botAdmin: true }, async c => {
  await c.reply('🔗 https://chat.whatsapp.com/' + await c.sock.groupInviteCode(c.chat))
})

cmd('nombre', { cat: '🛡️ Admin', desc: 'Cambia el nombre del grupo', usage: 'nuevo nombre', group: true, admin: true, botAdmin: true }, async c => {
  if (!c.args) return c.reply('Uso: /nombre Nuevo nombre')
  await c.sock.groupUpdateSubject(c.chat, c.args.slice(0, 100))
  await c.reply('✅ Nombre actualizado.')
})

cmd('desc', { cat: '🛡️ Admin', desc: 'Cambia la descripción del grupo', usage: 'texto', group: true, admin: true, botAdmin: true }, async c => {
  if (!c.args) return c.reply('Uso: /desc Nueva descripción')
  await c.sock.groupUpdateDescription(c.chat, c.args)
  await c.reply('✅ Descripción actualizada.')
})

cmd(['borrar', 'del'], { cat: '🛡️ Admin', desc: 'Borra el mensaje al que respondes', group: true, admin: true, botAdmin: true }, async c => {
  if (!c.quoted) return c.reply('Responde al mensaje que quieres borrar.')
  await c.sock.sendMessage(c.chat, { delete: { remoteJid: c.chat, fromMe: false, id: c.quoted.id, participant: c.quoted.sender } })
})

cmd('warn', { cat: '🛡️ Admin', desc: `Advierte a alguien (${CONFIG.maxWarns} = expulsión)`, usage: '@user', group: true, admin: true }, async c => {
  if (!c.target) return c.reply('Menciona o responde al mensaje de la persona.')
  if (isAdminOf(c.meta, c.target)) return c.reply('No puedo advertir a un admin.')
  const cfg = G(c.chat), k = num(c.target)
  cfg.warns[k] = (cfg.warns[k] || 0) + 1
  save()
  if (cfg.warns[k] >= CONFIG.maxWarns) {
    if (!c.isBotAdmin) return c.reply(`⚠️ ${mention(c.target)} llegó a ${cfg.warns[k]} advertencias, pero necesito ser admin para expulsar.`, [c.target])
    delete cfg.warns[k]; save()
    await c.sock.groupParticipantsUpdate(c.chat, [c.target], 'remove')
    return c.reply(`🚫 ${mention(c.target)} llegó al límite de advertencias y fue expulsado.`, [c.target])
  }
  await c.reply(`⚠️ ${mention(c.target)} advertencia ${cfg.warns[k]}/${CONFIG.maxWarns}.`, [c.target])
})

cmd('warns', { cat: '🛡️ Admin', desc: 'Ver advertencias de alguien', usage: '@user', group: true }, async c => {
  const t = c.target || c.sender
  await c.reply(`📊 ${mention(t)} tiene ${G(c.chat).warns[num(t)] || 0}/${CONFIG.maxWarns} advertencias.`, [t])
})

cmd('resetwarns', { cat: '🛡️ Admin', desc: 'Reinicia advertencias de alguien', usage: '@user', group: true, admin: true }, async c => {
  if (!c.target) return c.reply('Menciona o responde al mensaje de la persona.')
  delete G(c.chat).warns[num(c.target)]; save()
  await c.reply(`✅ Advertencias de ${mention(c.target)} reiniciadas.`, [c.target])
})

// ═════════════ CONFIGURACIÓN DEL GRUPO ═════════════
cmd('setreglas', { cat: '⚙️ Configuración', desc: 'Define las reglas del grupo', usage: 'texto', group: true, admin: true }, async c => {
  if (!c.args) return c.reply('Uso: /setreglas 1. Respeto\n2. Sin spam')
  G(c.chat).rules = c.args; save()
  await c.reply('✅ Reglas guardadas. Se muestran con /reglas')
})

cmd('bienvenida', { cat: '⚙️ Configuración', desc: 'Activa/desactiva la bienvenida', usage: 'on|off', group: true, admin: true }, async c => {
  const a = c.args.toLowerCase()
  if (!['on', 'off'].includes(a)) return c.reply('Uso: /bienvenida on  o  /bienvenida off')
  G(c.chat).welcome = a === 'on'; save()
  await c.reply(`👋 Bienvenida ${a === 'on' ? 'activada' : 'desactivada'}.`)
})

cmd('setbienvenida', { cat: '⚙️ Configuración', desc: 'Mensaje de bienvenida (usa @user y @grupo)', usage: 'texto', group: true, admin: true }, async c => {
  if (!c.args) return c.reply('Uso: /setbienvenida Hola @user, bienvenido a @grupo 🎉')
  G(c.chat).welcomeMsg = c.args; save()
  await c.reply('✅ Mensaje de bienvenida guardado.')
})

cmd('antilink', { cat: '⚙️ Configuración', desc: 'Borra links de grupos de WhatsApp', usage: 'on|off', group: true, admin: true, botAdmin: true }, async c => {
  const a = c.args.toLowerCase()
  if (!['on', 'off'].includes(a)) return c.reply('Uso: /antilink on  o  /antilink off')
  G(c.chat).antilink = a === 'on'; save()
  await c.reply(`🔗 Antilink ${a === 'on' ? 'activado' : 'desactivado'}.`)
})

// ───────────── Descarga de media ─────────────
async function getMedia(c) {
  const kind = x => x?.imageMessage || x?.videoMessage || x?.stickerMessage
  const opts = { logger: log, reuploadRequest: c.sock.updateMediaMessage }
  if (kind(c.msg)) return downloadMediaMessage(c.m, 'buffer', {}, opts)
  if (c.quoted && kind(c.quoted.message)) {
    return downloadMediaMessage({ key: { remoteJid: c.chat, id: c.quoted.id, participant: c.quoted.sender }, message: c.quoted.message }, 'buffer', {}, opts)
  }
  return null
}

// ───────────── Antilink (moderación silenciosa, apagado por defecto) ─────────────
const LINK_RE = /chat\.whatsapp\.com\/[A-Za-z0-9]{10,}/i
async function antilink(sock, m, chat, sender, text) {
  if (!G(chat).antilink || !LINK_RE.test(text)) return
  const meta = await sock.groupMetadata(chat)
  if (isAdminOf(meta, sender)) return
  if (!botIdList(sock).some(b => isAdminOf(meta, b))) return
  await sock.sendMessage(chat, { delete: m.key })
  const cfg = G(chat), k = num(sender)
  cfg.warns[k] = (cfg.warns[k] || 0) + 1
  if (cfg.warns[k] >= CONFIG.maxWarns) {
    delete cfg.warns[k]; save()
    await sock.groupParticipantsUpdate(chat, [sender], 'remove')
  } else {
    save()
    await sock.sendMessage(chat, { text: `🚫 ${mention(sender)} no se permiten links de otros grupos. Advertencia ${cfg.warns[k]}/${CONFIG.maxWarns}.`, mentions: [sender] })
  }
}

// ───────────── Manejador principal ─────────────
const cooldown = new Map()

async function handle(sock, m) {
  if (!m.message || m.key.remoteJid === 'status@broadcast') return
  const chat = m.key.remoteJid
  const isGroup = chat.endsWith('@g.us')
  const msg = unwrap(m.message)
  const text = getText(msg).trim()
  const sender = m.key.fromMe ? sock.user.id : (isGroup ? m.key.participant : chat)

  // Solo se responde a mensajes que empiezan con el prefijo
  if (!text.startsWith(CONFIG.prefix)) {
    if (isGroup && !m.key.fromMe) await antilink(sock, m, chat, sender, text)
    return
  }

  const cmdName = text.slice(CONFIG.prefix.length).split(/\s+/)[0].toLowerCase()
  const command = commands.get(cmdName)
  if (!command) return // comando desconocido: silencio

  // Anti-spam
  const now = Date.now()
  if (now - (cooldown.get(sender) || 0) < CONFIG.cooldownMs) return
  cooldown.set(sender, now)

  const args = text.slice(CONFIG.prefix.length + cmdName.length).trim()
  const info = getCtx(msg)
  const mentioned = info.mentionedJid || []
  const quoted = info.quotedMessage ? { id: info.stanzaId, sender: info.participant, message: unwrap(info.quotedMessage) } : null
  const reply = (t, mentions = []) => sock.sendMessage(chat, { text: t, mentions }, { quoted: m })

  let meta = null, isAdmin = false, isBotAdmin = false
  if (isGroup) {
    meta = await sock.groupMetadata(chat)
    isAdmin = isAdminOf(meta, sender)
    isBotAdmin = botIdList(sock).some(b => isAdminOf(meta, b))
  }
  const isOwner = !!m.key.fromMe || CONFIG.owners.includes(num(sender))

  if (command.group && !isGroup) return reply('Este comando solo funciona en grupos.')
  if (command.admin && !(isAdmin || isOwner)) return reply('⛔ Solo los admins pueden usar este comando.')
  if (command.botAdmin && !isBotAdmin) return reply('⚠️ Necesito ser admin del grupo para hacer eso.')

  await command.run({
    sock, m, msg, chat, sender, args, quoted, mentioned, meta, isGroup, isAdmin, isBotAdmin, isOwner, reply,
    target: mentioned[0] || quoted?.sender,
  })
}

// ───────────── Conexión ─────────────
let phone = (process.env.PHONE || '').replace(/\D/g, '')

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('./session')
  const { version } = await fetchLatestBaileysVersion()
  const needsPairing = !state.creds.registered

  if (needsPairing && !phone) {
    console.log(`\n=== ${CONFIG.name} · Vinculación ===`)
    phone = (await ask('Número de WhatsApp del bot (código de país + número, sin + ni espacios): ')).replace(/\D/g, '')
    if (phone.length < 8) { console.log('Número inválido.'); process.exit(1) }
  }

  const sock = makeWASocket({
    version,
    auth: state,
    logger: log,
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  })
  let pairingRequested = false

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    // El código se pide cuando el socket ya está listo (llega el evento qr)
    if (qr && needsPairing && !pairingRequested) {
      pairingRequested = true
      try {
        const code = await sock.requestPairingCode(phone)
        console.log(`\n🔑 Tu código de vinculación: ${code.match(/.{1,4}/g).join('-')}`)
        console.log('WhatsApp → Dispositivos vinculados → Vincular con número de teléfono → escribe el código.\n')
      } catch (e) {
        pairingRequested = false
        console.error('No se pudo pedir el código:', e?.message || e)
      }
    }
    if (connection === 'open') console.log(`✅ ${CONFIG.name} conectado. Escribe ${CONFIG.prefix}menu en un chat.`)
    if (connection === 'close') {
      const status = lastDisconnect?.error?.output?.statusCode
      if (status === DisconnectReason.loggedOut) {
        console.log('Sesión cerrada desde el teléfono. Borra la carpeta ./session y vuelve a iniciar.')
        process.exit(0)
      }
      console.log(`Conexión cerrada (${status ?? 'sin código'}). Reconectando…`)
      setTimeout(start, 3000)
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    for (const m of messages) {
      try { await handle(sock, m) } catch (e) { console.error('Error en comando:', e?.message || e) }
    }
  })

  // Bienvenida a nuevos miembros
  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
    if (action !== 'add') return
    const cfg = G(id)
    if (!cfg.welcome) return
    try {
      const meta = await sock.groupMetadata(id)
      for (const p of participants) {
        const jid = typeof p === 'string' ? p : p.id
        const tpl = cfg.welcomeMsg || `👋 ¡Bienvenido/a @user a *@grupo*!\n\nUsa ${CONFIG.prefix}reglas para ver las reglas y ${CONFIG.prefix}menu para ver mis comandos.`
        await sock.sendMessage(id, { text: tpl.replaceAll('@user', mention(jid)).replaceAll('@grupo', meta.subject), mentions: [jid] })
      }
    } catch (e) { console.error('Error en bienvenida:', e?.message || e) }
  })
}

// Servidor mínimo para hostings que exigen un puerto abierto (usa PORT si el hosting lo define)
const PORT = process.env.PORT || process.env.SERVER_PORT || 8080
http.createServer((_, res) => { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(`${CONFIG.name} activo`) })
  .listen(PORT, () => console.log(`🌐 Servidor de salud escuchando en el puerto ${PORT}`))

process.on('unhandledRejection', e => console.error('Rechazo no controlado:', e?.message || e))
start()
