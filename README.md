# arset — Bot de WhatsApp para comunidades

Solo responde a mensajes que empiezan con `/`. Se vincula con **código de emparejamiento** (sin QR).

## Requisitos
- Node.js 20 o superior
- **ffmpeg** (gifs de anime y stickers de video)
- **yt-dlp** (para /ytaudio y /ytvideo). Mantenlo actualizado: `yt-dlp -U`

## Instalar y correr
1. `npm install`
2. `node index.js`
3. Escribe el número del bot (código de país + número, sin `+`).
4. En ese teléfono: WhatsApp → Dispositivos vinculados → Vincular con número de teléfono → escribe el código de la terminal.
5. Agrega el bot a un grupo, hazlo admin y escribe `/menu`.

Variables opcionales: `PHONE=...` `OWNERS=num1,num2` `BOT_NAME=arset` `YTDLP_PATH=...` `FFMPEG_PATH=...`

## Comandos
- General: /menu /ping /info /reglas /admins
- Descargas: /ytaudio (alias /play /mp3), /ytvideo (alias /video) — nombre o link, máx. 15 min
- Utilidades: /sticker /calc /encuesta /elegir
- Diversión: /dado /moneda /8ball /sorteo
- Anime con @user o respondiendo: /pat /hug /kiss /cuddle /slap /poke /bite /punch /kick /tickle /highfive /handhold /feed /yeet /bonk /lick /glomp
- Anime solos: /cry /dance /laugh /blush /smile /happy /bored /sleep /pout /smug /think /nom /wave /wink /facepalm /shrug /stare /baka /thumbsup /cringe
- Imágenes: /waifu /neko
- Comunidad: /todos /ocultar
- Admin: /kick /promover /degradar /grupo /link /nombre /desc /borrar /warn /warns /resetwarns
- Config: /setreglas /bienvenida /setbienvenida /antilink

## Notas
- Comandos desconocidos y mensajes sin `/` se ignoran. Excepciones: bienvenida a nuevos miembros y antilink (apagado por defecto).
- Los gifs vienen de nekos.best y waifu.pics (gratis, sin API key); si una falla, usa la otra.
- Descarga solo contenido que tengas derecho a usar.
- Baileys es no oficial: usa un número secundario y evita el spam para reducir riesgo de bloqueo.
- Si falla la conexión: `npm i @whiskeysockets/baileys@latest` y borra la carpeta `session`.
