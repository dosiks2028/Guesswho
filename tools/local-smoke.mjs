import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
const base = process.argv[2] || 'http://127.0.0.1:3000';
async function post(path, body, token = '') {
  const response = await fetch(base + '/api/local/' + path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
  const value = await response.json(); if (!response.ok) throw new Error(value.error); return value;
}
const a = await post('session',{username:'QA Host'});
const b = await post('session',{username:'QA Guest'});
const call = (player,fn,args={}) => post('rpc',{fn,args},player.token);
const room = await call(a,'create_room',{p_category:'naruto',p_public:false});
const socket = new WebSocket(base.replace(/^http/,'ws') + '/api/local/events');
const received = [];
await new Promise((resolve,reject) => {
  const timer = setTimeout(() => reject(new Error('WebSocket timeout')),10000);
  socket.on('open',() => socket.send(JSON.stringify({type:'auth',token:a.token,room:room.id,mode:'watch'})));
  socket.on('message',raw => { const data = JSON.parse(raw); received.push(data); if (data.type === 'ready') { clearTimeout(timer); resolve(); } });
  socket.on('error',reject);
});
await call(a,'select_secret',{p_room:room.id,p_character:'naruto-naruto-uzumaki'});
await call(b,'join_room',{p_code:room.code});
await call(b,'select_secret',{p_room:room.id,p_character:'naruto-sasuke-uchiha'});
await call(a,'send_message',{p_room:room.id,p_body:'Testing realtime chat ✓'});
const state = await call(b,'get_game',{p_room:room.id});
assert.equal(state.secret,'naruto-sasuke-uchiha');
assert.equal(state.room.status,'playing');
assert.equal(state.messages.at(-1).body,'Testing realtime chat ✓');
assert(received.some(message => message.type === 'update'));
await assert.rejects(call(b,'guess_character',{p_room:room.id,p_character:'naruto-naruto-uzumaki'}),/NOT_YOUR_TURN/);
await call(a,'guess_character',{p_room:room.id,p_character:'naruto-sasuke-uchiha'});
const result = await call(b,'guess_character',{p_room:room.id,p_character:'naruto-itachi-uchiha'});
assert.equal(result.correct,false);
assert.equal(result.reward,0);
socket.close();
console.log('PASS: two players, private room, secret isolation, WebSocket events, chat, turn validation, match settlement');
