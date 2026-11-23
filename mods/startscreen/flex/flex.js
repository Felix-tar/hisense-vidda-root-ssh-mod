/* BEGIN FLEX DENON MODULE */
/* FLEX Denon UI, ES5/Cobalt. File IPC only; no receiver write on opening/focusing. */
(function () {
  'use strict';
  if (window.__flexDenon) window.__flexDenon.close();
  var d = { opened: false, el: null, cat: 0, row: 0, side: 0, edit: false,
    data: {}, rows: [], pending: null, last: 0, notice: '', undo: null, sequence: null,
    sources: [], labels: {}, pollAt: 0, tvQueue: [], seqKind: '', seqInput: false, sourceAt: 0, videoFor: '', resolution: '', typing: false, onSelected: null };
  var cats = ['Uebersicht', 'Quellen & Zonen', 'Lautsprecherpegel', 'Klang', 'Audyssey', 'Quellennamen', 'Diagnose'];
  var labels = {FL:'Front links',FR:'Front rechts',C:'Center',SW:'Subwoofer',SW2:'Subwoofer 2',SW3:'Subwoofer 3',SW4:'Subwoofer 4',SL:'Surround links',SR:'Surround rechts',SBL:'Surround hinten links',SBR:'Surround hinten rechts',FHL:'Height vorne links',FHR:'Height vorne rechts',TFL:'Top vorne links',TFR:'Top vorne rechts',TML:'Top Mitte links',TMR:'Top Mitte rechts',TRL:'Top hinten links',TRR:'Top hinten rechts'};
  function esc(v) { return String(v === undefined ? 'Nicht gemeldet' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function read() { try { var s=window.hisense.file.read('flexdenon/response',1);return typeof s==='string'?JSON.parse(s):null; } catch(e){return null;} }
  function parse(raw) {
    var data={}, a=raw.split(/\r?\n/), keys=['SYSDA ','PSTONE CTRL ','PSMULTEQ:','PSDYNVOL ','PSDYNEQ ','PSBAS ','PSTRE ','ZM','SI','MV','MU','MS'];
    for(var i=0;i<a.length;i++) {
      var s=a[i],m=s.match(/^CV([A-Z0-9]+) ([0-9]{2,3})$/);
      if(m&&labels[m[1]])data['CV'+m[1]+' ']=m[2];
      if(s==='Z2ON'||s==='Z2OFF')data.Z2POWER=s.substr(2);
      if(s==='Z2GAME1'||s==='Z2TV')data.Z2SOURCE=s.substr(2);
      for(var j=0;j<keys.length;j++)if(s.indexOf(keys[j])===0) {
        var v=s.substr(keys[j].length).replace(/\s+$/, '');
        if(keys[j]==='MV'&&!/^[0-9]{2,3}$/.test(v))continue;
        data[keys[j]]=v;break;
      }
    }
    return data;
  }
  function number(v) {return /^[0-9]{2,3}$/.test(v||'')?(v.length===2?Number(v):Number(v)/10):null;}
  function encoded(v){var i=Math.round(v*10);return i%10===0?('0'+Math.floor(i/10)).slice(-2):('00'+i).slice(-3);}
  function xml(s){return new DOMParser().parseFromString(s,'text/xml');}
  function text(el,tag){var n=el.getElementsByTagName(tag)[0];return n?n.textContent:'';}
  function updateVideoMetadata(a){
    d.sourceAt=0;d.videoFor='';d.resolution='';
    if(!a.video||!d.data.SI)return;
    try {
      var res=xml(a.video).getElementsByTagName('Resolution')[0];
      var input=res?text(res,'Input').replace(/^\s+|\s+$/g,''):'';
      if(!input)return;
      d.sourceAt=Date.now();d.videoFor=d.data.SI;d.resolution=input;
    }catch(e){ /* Kein beobachteter Bildstatus. */ }
  }
  function sourceMetadata(a,command){
    if(command==='SOURCES'&&a.ok)updateVideoMetadata(a);
    // Geraete an den Quellen werden nicht mehr per IP abgefragt (15.11.2026): Umschalten macht CEC.
    if(a.labels)d.labels=a.labels;
    if(!a.assign||!a.names)return;
    try {
      var doc=xml(a.assign),names=xml(a.names),map={},rename={},items=doc.getElementsByTagName('SelectionList')[0].getElementsByTagName('HDMI')[0].getElementsByTagName('Item');
      for(var i=0;i<items.length;i++)map[items[i].getAttribute('index')]=items[i].textContent;
      var ns=names.getElementsByTagName('Source');for(i=0;i<ns.length;i++)rename[ns[i].getAttribute('index')]={name:text(ns[i],'Rename'),auto:text(ns[i],'Auto')};
      var rows=doc.documentElement.childNodes,result=[],commands={'1':'SAT/CBL','3':'BD','4':'GAME1','5':'MPLAY','7':'AUX1','8':'AUX2'};
      for(i=0;i<rows.length;i++)if(rows[i].nodeName==='Source'){
        var id=rows[i].getAttribute('index'),port=Number(map[text(rows[i],'HDMI')]),r=rename[id]||{};
        if(port>=1&&port<=6&&commands[id])result.push({port:port,command:commands[id],name:(d.labels[port]&&d.labels[port]!=='-'?d.labels[port]:'')||r.name||('HDMI '+port),label:d.labels[port]&&d.labels[port]!=='-'?d.labels[port]:'',hidden:d.labels[port]==='-',receiverName:r.name||'',autoName:r.auto||''});
      }
      result.sort(function(x,y){return x.port-y.port;});d.sources=result;
    }catch(e){d.notice='Quellenliste konnte nicht gelesen werden';}
  }
  function sourceStatus(s){
    var fresh=Date.now()-d.sourceAt<60000;
    if(fresh&&d.data.ZM==='ON'&&s.command===d.data.SI&&d.videoFor===s.command&&d.resolution&&d.resolution!=='---')return 'Signal '+d.resolution;
    if(!d.sourceAt||Date.now()-d.sourceAt>60000)return 'Status nicht aktuell';
    if(d.data.ZM!=='ON')return 'Receiver MAIN aus';
    if(s.command===d.data.SI)return d.videoFor===s.command&&d.resolution&&d.resolution!=='---'?'Signal '+d.resolution:'Ausgewaehlt';
    return 'Betriebsstatus unbekannt';
  }
  function selectSource(port,done){
    if(d.pending||d.sequence)return false;
    for(var i=0;i<d.sources.length;i++)if(d.sources[i].port===port){
      d.onSelected=done;d.undo=null;d.sequence=[];d.seqKind='source';d.seqInput=false;
      var fresh=Date.now()-d.last<15000;
      if(!fresh||d.data.Z2POWER!=='OFF')d.sequence.push('Z2OFF');
      if(!fresh||d.data.ZM!=='ON')d.sequence.push('ZMON');
      d.sequence.push('SI'+d.sources[i].command);send(d.sequence.shift());return true;
    }
    return false;
  }
  // Denon auf TV-Ton (Eingang TV) beim Start einer TV-App von der Startseite (sources.js denonAutoTv, 17.11.2026):
  // bei frischem Status nur die noetigen Schritte, jeder gesichert, gesendet und nachgelesen. ZONE2 bleibt, wie sie ist
  // (PC am Schreibtisch), anders als bei selectSource.
  // Ist der Dienst belegt (Statusabfrage, andere Folge), wird die Anfrage eingereiht und im naechsten freien Takt ausgefuehrt
  // (18.11.2026: vorher nach 3 s verworfen, am TV "TV-Ton nicht gesetzt (Dienst belegt)", danach kein Ton). Mehrere
  // Anfragen werden zu einer zusammengefasst; jeder Rueckruf bekommt das Ergebnis.
  // want (optional): Pruefung auf dem Stand bei der Ausfuehrung (Review 18.11.2026: eine eingereihte Anfrage darf nicht
  // auf altem Stand entscheiden, z. B. ein inzwischen gewaehltes Profil zuruecknehmen). Sagen alle Anfragen mit want auf
  // frischem Stand "nicht noetig", wird nichts gesendet und jeder Rueckruf ohne Fehler aufgerufen.
  function selectTv(done,want){
    var r={done:done||null,want:want||null};
    if(d.pending||d.sequence){d.tvQueue.push(r);return true;}
    return runTv([r]);
  }
  function runTv(q){
    var need=Date.now()-d.last>=15000;   // Stand nicht frisch: wie bisher ausfuehren
    for(var i=0;i<q.length&&!need;i++){try{need=!q[i].want||!!q[i].want(d.data);}catch(e){need=true;}}
    var all=function(err){for(var j=0;j<q.length;j++)if(q[j].done){try{q[j].done(err);}catch(e){}}};
    if(!need){all();return true;}
    return startTv(all);
  }
  function startTv(done){
    done=done||function(){};
    d.onSelected=done;d.undo=null;d.sequence=[];d.seqKind='tv';
    var fresh=Date.now()-d.last<15000;
    if(!fresh||d.data.ZM!=='ON')d.sequence.push('ZMON');
    if(!fresh||d.data.SI!=='TV')d.sequence.push('SITV');
    if(!d.sequence.length){d.sequence=null;d.onSelected=null;d.seqKind='';done();return true;}
    send(d.sequence.shift());return true;
  }
  // Neue Wahl des Nutzers (Kodi, App, andere Konsole, Zurueck): eine laufende Konsolen-Umschaltfolge (selectSource) nicht
  // weiterfuehren. Der gerade laufende Befehl endet noch, weitere Schritte und der Rueckruf der alten Wahl entfallen.
  // Rueckgabe: true, wenn ein Eingangswechsel auf ein Geraet (SI..., nicht SITV) schon gesendet ist oder gerade laeuft;
  // dann meldet sich der Denon gleich per CEC als aktive Quelle, und der Launcher springt auf HDMI1.
  function abortSequence(){
    if(d.seqKind!=='source')return false;
    var input=d.seqInput||!!(d.pending&&/^SI/.test(d.pending.command)&&d.pending.command!=='SITV');
    d.sequence=null;d.onSelected=null;d.seqKind='';
    return input;
  }
  // Statusabfrage (Eingaenge, Bild) jetzt, wenn der Dienst frei ist; false = belegt.
  function refresh(){if(d.typing||d.pending||d.sequence||d.tvQueue.length)return false;d.pollAt=Date.now();send('SOURCES');return true;}
  function renameSource(port){
    var src=null;for(var i=0;i<d.sources.length;i++)if(d.sources[i].port===port)src=d.sources[i];
    if(!src||!window.UI||!UI.showSoftKeyboard)return;
    d.typing=true;d.typingAt=Date.now();
    try { UI.showSoftKeyboard({value:src.name,position:10,maxLength:18,curLang:'ENG',curMode:0,viewType:'text',workType:'text',curMarket:'EU',curArea:0,InputName:'Denon HDMI '+port,callback:function(){
      d.typing=false;var name=String(this.value||'').replace(/[\r\n]/g,' ').replace(/^\s+|\s+$/g,'');
      if(name)send('LABEL'+port+' '+name);else render();
    }}); } catch(e) { d.typing=false;d.notice='Tastatur nicht verfuegbar';render(); }
  }
  function send(command) {
    if(d.pending)return;
    if(d.seqKind==='source'&&/^SI/.test(command)&&command!=='SITV')d.seqInput=true;
    var id=String(Date.now())+'-'+String(Math.floor(Math.random()*100000));
    d.pending={id:id,command:command,time:Date.now()};
    d.notice=command==='STATUS'||command==='SOURCES'?'Status wird gelesen ...':'Wird gesichert, gesetzt und geprueft ...';
    try {
      var rc=window.hisense.file.write('flexdenon/request',id+'\n'+command+'\n',1);
      if(rc!==0&&rc!==undefined)throw new Error('Dateizugriff '+rc);
    } catch(e){d.pending=null;d.sequence=null;d.notice='TV-Dienst nicht erreichbar: '+e;selectionFailed(d.notice);}
    render();
  }
  function row(label,key,options,min,max,offset){return {label:label,key:key,options:options,min:min,max:max,offset:offset||0};}
  function rows(){
    var a=[],s=d.data,k;
    if(d.cat===0){
      a=[row('Wohnzimmer / MAIN','ZM',['OFF','ON']),row('Lautstaerke','MV',null,0,80,80),row('Stumm','MU',['OFF','ON']),{label:'Aktive Quelle',info:s.SI},{label:'Klangmodus',info:s.MS},{label:'Eingangssignal',info:s['SYSDA ']||'Nicht gemeldet'}];
    }else if(d.cat===1){
      a=[{label:'TV-Apps hoeren',profile:['Z2OFF','ZMON','SITV']},{label:'PC im Wohnzimmer',profile:['Z2OFF','ZMON','SIGAME1']},{label:'PC am Schreibtisch',profile:['Z2ON','Z2GAME1','ZMOFF']},row('MAIN Quelle','SI',['TV','GAME1']),row('ZONE2','Z2POWER',['OFF','ON']),row('ZONE2 Quelle','Z2SOURCE',['GAME1'])];
    }else if(d.cat===2){
      for(k in labels)if(labels.hasOwnProperty(k)&&s['CV'+k+' ']!==undefined)a.push(row(labels[k],'CV'+k+' ',null,38,62,50));
      if(!a.length)a.push({label:'Keine Kanaele gemeldet',info:'MAIN einschalten und aktualisieren'});
    }else if(d.cat===3){
      a=[row('Klangmodus','MS',['STEREO','DIRECT','PURE DIRECT','DOLBY AUDIO-DSUR','DTS NEURAL:X']),row('Klangregelung','PSTONE CTRL ',['OFF','ON']),row('Bass','PSBAS ',null,44,56,50),row('Hoehen','PSTRE ',null,44,56,50)];
    }else if(d.cat===4){
      a=[row('MultEQ XT32','PSMULTEQ:',['OFF','AUDYSSEY','BYP.LR','FLAT']),row('Dynamic EQ','PSDYNEQ ',['OFF','ON']),row('Dynamic Volume','PSDYNVOL ',['OFF','LIT','MED','HEV'])];
    }else if(d.cat===5){
      // Name "-" blendet den Eingang auf Startseite und in Quellen aus (17.11.2026, z. B. Geraet entfernt, der Denon
      // behaelt dessen CEC-Namen); ein anderer Name zeigt ihn wieder.
      for(var si=0;si<d.sources.length;si++)a.push({label:'Denon HDMI '+d.sources[si].port,info:d.sources[si].hidden?'ausgeblendet (Name -)':d.sources[si].name,rename:d.sources[si].port});
      if(!a.length)a.push({label:'Quellen laden',refresh:true});
    }else{
      var arc='Nicht gelesen',fmt='Nicht gelesen';
      try{arc=window.modeljs.sound.getArcDevExist()?'Erkannt':'Nicht erkannt';fmt={1:'Bitstream',2:'PCM',3:'Auto',4:'Dolby Digital',5:'Dolby Digital Plus'}[window.modeljs.sound.getDigitalAudioOut()]||'Unbekannt';}catch(e){}
      a=[{label:'Receiver',info:'Configured receiver'},{label:'ARC-Geraet am TV',info:arc},{label:'TV-Digitalausgang',info:fmt},{label:'Letzte Antwort',info:d.last?new Date(d.last).toLocaleTimeString():'Noch keine'}, {label:'Status aktualisieren',refresh:true}, {label:'Letzte Einzelaenderung zurueck',undo:true}];
    }
    for(var i=0;i<a.length;i++)if(a[i].key){
      var r=a[i];r.value=s[r.key];r.disabled=r.value===undefined;
      if(r.key==='PSBAS '||r.key==='PSTRE ')r.disabled=r.disabled||s['PSTONE CTRL ']!=='ON'||s['PSDYNEQ ']==='ON';
      if(r.key!=='ZM'&&r.key!=='Z2POWER'&&r.key!=='Z2SOURCE'&&s.ZM!=='ON')r.disabled=true;
      if(r.min!==undefined&&number(r.value)===null)r.disabled=true;
    }
    return a;
  }
  function value(r){
    if(r.profile)return 'OK: Profil bestaetigen';
    if(r.refresh)return 'OK';if(r.undo)return d.undo?'OK':'Noch keine';
    if(r.info!==undefined)return r.info;
    if(r.disabled)return 'Im aktuellen Zustand nicht verfuegbar';
    var v=d.edit&&d.side===1&&d.rows[d.row]&&d.rows[d.row].key===r.key?d.draft:r.value;
    if(r.min!==undefined){var n=number(v);return n===null?'Nicht gemeldet':(n-r.offset).toFixed(1)+' dB';}
    return {ON:'Ein',OFF:'Aus',TV:'TV Audio',GAME1:'PC (HDMI 4)',AUDYSSEY:'Reference','BYP.LR':'L/R Bypass',FLAT:'Flat',LIT:'Leicht',MED:'Mittel',HEV:'Stark'}[v]||v;
  }
  function render(){
    if(!d.opened)return;
    if(!d.el){d.el=document.createElement('div');d.el.id='flex-denon';document.body.appendChild(d.el);}
    d.rows=rows();d.row=Math.max(0,Math.min(d.row,d.rows.length-1));
    var html='<div class="dn-head"><div class="dn-brand">DENON</div><div class="dn-sub">AVC-X3800H &nbsp; / &nbsp; '+esc(d.data.SI||'Verbinden ...')+' &nbsp; / &nbsp; '+esc(d.data.MS||'')+'</div></div><div class="dn-nav">';
    for(var c=0;c<cats.length;c++)html+='<div class="dn-tab '+(c===d.cat?(d.side===0?'focus':'selected'):'')+'">'+esc(cats[c])+'</div>';
    html+='</div><div class="dn-content"><div class="dn-title">'+esc(cats[d.cat])+'</div>';
    var start=Math.max(0,d.row-5),end=Math.min(d.rows.length,start+7);
    for(var i=start;i<end;i++){var r=d.rows[i];html+='<div class="dn-row '+(d.side===1&&i===d.row?'focus ':'')+(r.disabled?'disabled':'')+'"><span>'+esc(r.label)+'</span><span class="dn-value">'+esc(value(r))+'</span></div>';}
    html+='</div><div class="dn-notice">'+esc(d.notice)+'</div><div class="dn-foot">'+(d.edit?'Links/Rechts: Wert waehlen &nbsp; OK: anwenden &nbsp; Zurueck: verwerfen':'Pfeile: navigieren &nbsp; OK: bearbeiten &nbsp; Zurueck: schliessen')+'</div>';
    d.el.innerHTML=html;
  }
  function close(){d.opened=false;d.edit=false;d.typing=false;if(!d.onSelected)d.sequence=null;if(d.el&&d.el.parentNode)d.el.parentNode.removeChild(d.el);d.el=null;}
  function open(){if(d.opened)return;d.opened=true;d.openedAt=Date.now();d.cat=0;d.row=0;d.side=0;d.edit=false;d.notice='';render();send('SOURCES');}
  function key(k){
    if(k===8||k===461||k===27){if(d.edit){d.edit=false;d.notice='Aenderung verworfen';render();}else close();return;}
    if(d.pending)return;
    if(d.edit){
      var r=d.rows[d.row];
      if(k===13){
        d.edit=false;
        if(r.profile){d.undo=null;d.sequence=r.profile.slice();send(d.sequence.shift());return;}
        if(d.draft===r.value){render();return;}
        var prefix=r.key==='Z2POWER'||r.key==='Z2SOURCE'?'Z2':r.key;
        d.undo=prefix+r.value;send(prefix+d.draft);return;
      }
      if(k===37||k===39){
        var delta=k===39?1:-1;
        if(r.options){var idx=r.options.indexOf(d.draft);d.draft=r.options[(idx+delta+r.options.length)%r.options.length];}
        else if(r.min!==undefined){var step=r.key==='PSBAS '||r.key==='PSTRE '?1:0.5;d.draft=encoded(Math.max(r.min,Math.min(r.max,number(d.draft)+delta*step)));}
      }
      render();return;
    }
    if(k===37){d.side=0;render();return;}
    if(k===39){d.side=1;render();return;}
    if(k===38||k===40){var dir=k===40?1:-1;if(d.side===0){d.cat=(d.cat+dir+cats.length)%cats.length;d.row=0;}else d.row=Math.max(0,Math.min(d.rows.length-1,d.row+dir));render();return;}
    if(k===13){
      if(d.side===0){d.side=1;render();return;}
      var a=d.rows[d.row];
      if(a.refresh){send('SOURCES');return;}
      if(a.rename){renameSource(a.rename);return;}
      if(a.undo&&d.undo){var u=d.undo;d.undo=null;send(u);return;}
      if(a.disabled){d.notice='Vom Receiver in diesem Zustand nicht verfuegbar';render();return;}
      if(a.key||a.profile){d.edit=true;d.draft=a.value;d.notice=a.profile?'OK schaltet Quellen und Zonen um. Zurueck bricht ab.':'Wert waehlen, dann mit OK anwenden.';render();}
    }
  }
  function tick(valid,sourceVisible){
    if(d.typing&&window.UI&&UI.isSoftKeyboardShown&&!UI.isSoftKeyboardShown()&&Date.now()-d.typingAt>1000){d.typing=false;render();}
    if(d.opened&&!valid&&!d.typing){close();return;}
    if(d.pending){
      var a=read();
      if(a&&a.id===d.pending.id){
        var command=d.pending.command;d.pending=null;
        if(a.raw){d.data=parse(a.raw);d.last=Date.now();}
        sourceMetadata(a,command);
        d.notice=a.ok?(command==='STATUS'||command==='SOURCES'?'Status aktuell':command.indexOf('LABEL')===0?'Anzeigename gespeichert':'Aenderung vom Receiver bestaetigt'):a.error;
        if(!a.ok){d.sequence=null;d.seqKind='';selectionFailed(d.notice);render();return;}
        if((d.opened||d.onSelected)&&d.sequence&&d.sequence.length){send(d.sequence.shift());return;}
        d.sequence=null;d.seqKind='';
        if(d.onSelected){var done=d.onSelected;d.onSelected=null;done();}
        render();
      }else if(Date.now()-d.pending.time>25000){d.pending=null;d.sequence=null;d.seqKind='';d.notice='Zeitlimit: Zustand unklar. Bitte Status aktualisieren.';selectionFailed(d.notice);render();}
    }else if(!d.sequence&&d.tvQueue.length){
      var q=d.tvQueue;d.tvQueue=[];
      runTv(q);
    }else if(d.opened&&!d.typing&&!d.edit&&Date.now()-d.last>10000)send('STATUS');
    else if(sourceVisible&&!d.opened&&!d.sequence&&Date.now()-d.pollAt>15000){d.pollAt=Date.now();send('SOURCES');}
  }
  function selectionFailed(message){if(d.onSelected){var done=d.onSelected;d.onSelected=null;done(message);}}
  window.__flexDenon={open:open,close:close,key:key,tick:tick,selectSource:selectSource,selectTv:selectTv,abortSequence:abortSequence,refresh:refresh,sourceStatus:sourceStatus,isTyping:function(){return d.typing;},isOpen:function(){return d.opened;},openedAt:function(){return d.openedAt;},state:function(){return {open:d.opened,pending:!!d.pending,data:d.data,notice:d.notice,sources:d.sources,sourceAt:d.sourceAt,busy:!!(d.pending||d.sequence||d.tvQueue.length)};}};
}());

/* END FLEX DENON MODULE */
/* flex.js — FLEX·TV Startseiten-Mod für den VIDAA-Launcher (hisenseUI, Cobalt).
   Eingebunden per <script> am Ende von /APPS/channelA/hisenseUI/index.html (nach app.js).
   Rückgängig: mods/startscreen/uninstall.sh bzw. docs/gui-mod/ROLLBACK.md.

   Schritt 2 — App-Reihe: Quellen, Netflix, Prime Video, Disney+, DAZN, UFC, YouTube, Alle Apps.
   Schritt 3 — keine Empfehlungen/Werbung/Thumbnails (cleanHome/patchMainTiles).
   Schritt 4 — Wetter-Widget (Open-Meteo, ohne Hersteller-Cloud), Startseite beim Einschalten,
               Wallpaper vorladen.

   Die Kacheln kommen aus dem Vuex-Store, Namespace "LauncherHis/" (state.mainTileData, gebaut
   aus allAppsData = Favorite + alle Apps + MyApps, davon die ersten 14). Wir filtern auf
   Datenebene statt per CSS, damit der Fokus der Fernbedienung nicht auf unsichtbaren Kacheln
   landet. Nichts wird gelöscht oder gespeichert: alle Apps bleiben unter "Alle Apps".
   ES5, weil Cobalt-Gold-Builds keine neueren Sprachmittel garantieren. Cobalt zeigt Bilder nur
   als CSS-Hintergrund an (kein <img>).

   Schutzregeln (analysis/audit-app-launch-20261028.md, Abschnitt 5): flex.js fasst App-Start und
   App-Lebenszyklus nie an. Keine eigenen nativen Objekte (nie ein zweites GUI-Service-Objekt,
   install.sh prüft das), Quelle und Player nur, solange keine App da ist, verzögerte
   Seiteneffekte prüfen ihre Bedingungen erst beim Feuern, Tasten werden nur verschluckt, solange
   unsere eigene Oberfläche vorne ist. Fehlt eine Launcher-API oder wirft sie, tut flex.js
   WENIGER (keine Quellenumschaltung, kein Verschlucken, kein Modulwechsel).
   Einzige Ausnahme (v10, Entscheidung des Besitzers 08.11.2026): OK auf der Kodi-Kachel beendet
   eine App, die nach HOME noch unter der Startseite liegt, mit den eigenen Aufrufen des Launchers
   (Abschnitt "App unter der Startseite beenden", uhStart). */
(function () {
  'use strict';

  // ---- Hot-Reload: eine neue Version beendet die laufende ----
  // Danach läuft der Tasten-Handler des Launchers VOR unserem (Reihenfolge der Listener vertauscht).
  // Darum App-Start und App-Lebenszyklus nur nach einem Neustart von hisenseUI bzw. einem
  // Kaltstart testen, nie nach einem Hot-Reload (Audit Risiko 8, Schutzregel 9).
  var prev = window.__flex;
  if (prev && prev.stop) {
    try { prev.stop(); } catch (e) { /* alte Instanz ignorieren */ }
  }
  var inst = { stopped: false, unwatch: [], timers: [], subs: [] };
  window.__flex = { version: 10, stop: stop };

  var T0 = Date.now();

  // ---- Konfiguration ----
  // Reihenfolge = Anzeige. id = appId aus launcherAllApps/Appinfo.json, name = appName ohne Leerzeichen.
  var KEEP = [
    { id: '1', name: 'netflix' },
    { id: '2', name: 'primevideo' },
    { id: '295', name: 'disney+' },
    { id: '162', name: 'dazn' },
    { id: '355', name: 'ufc' },
    { id: '3', name: 'youtube' },
    { id: '-3', name: 'myapps' } // "Alle Apps" (öffnet die VIDAA-Übersicht aller Apps)
  ];
  // Eigene Kachel ganz links: startet Kodi (/APPS/kodi). flex.js kann keine Programme starten; es
  // legt nur die Anforderung flexkodi/start an, der Wächter /APPS/kodi/kodi-watch.sh (root, beim
  // Booten gestartet) startet daraufhin /APPS/kodi/kodi.sh. Über den originalen Startpfad darf die
  // Kachel nie laufen (handleTileKey). Vor "Alle Apps": Quellen-Auswahl (VIDAA-Seite "AllInputs").
  var KODI_TILE = { appName: 'Kodi', appId: 'flex-kodi', uid: 'flex-kodi', cmd: 6,
    img: 'static/flex/tile-kodi.png', appReList: [], visibility: '' };
  var SOURCES_TILE = { appName: 'Quellen', appId: 'flex-sources', uid: 'flex-sources', cmd: 6,
    img: 'static/flex/tile-sources.png', appReList: [], visibility: '' };
  // Eigener Eintrag am Ende von "Alle Apps": Seite "Bilder" (Bildschirmschoner-Pool und
  // Hintergrund wählen). Steht in LauncherHis.allAppsData (daraus baut die Seite "Alle Apps" ihr
  // Raster), nicht in der Startleiste. Über den originalen Startpfad darf er nie laufen
  // (startThirdPartyApp mit leerer URL): siehe allAppsKey() und onKey().
  var GALLERY_TILE = { appName: 'Bilder', appId: 'flex-gallery', uid: 'flex-gallery', cmd: 6, url: '',
    img: 'static/flex/tile-gallery.png', appReList: [], visibility: '' };
  var DENON_TILE = { appName: 'Denon', appId: 'flex-denon', uid: 'flex-denon', cmd: 6, url: '',
    img: 'static/flex/tile-denon.png', appReList: [], visibility: '' };
  var IMG_OVERRIDE = { '-3': 'static/flex/tile-allapps.png' };
  // Der Launcher fügt "MyApps" nur ein, wenn genug Apps da sind; beim Start fehlt es zeitweise.
  // Damit die Leiste nicht springt, ergänzen wir es selbst (gleiche Daten wie im Launcher).
  var MYAPPS_TILE = { appName: 'MyApps', appId: '-3', uid: 'AllApps', cmd: 6, img: IMG_OVERRIDE['-3'],
    appReList: [], visibility: '' };
  // Wetter: Open-Meteo (kein Schlüssel, keine Hersteller-Cloud). Ort hier anpassen.
  var WEATHER = { lat: null, lon: null, name: '', everyMin: 30 };
  // Beim Einschalten: 'always' = immer Startseite, 'nosignal' = nur wenn die Quelle kein
  // Signal hat (z. B. HDMI mit ausgeschalteter Konsole), 'off' = Hisense-Standard
  var HOME_ON_POWER = 'always';
  // Bildschirmschoner: nach idleSec ohne Taste auf der Startseite Oberfläche aus (nur Hintergrund),
  // nach wallpaperSec Diashow über den nativen Foto-Player, je slideSec. effect = Übergang des
  // Players: 0 ohne, 18 Streifen, 40 Balken, 17 Schachbrett, 30 horizontal öffnen, 38 Form,
  // 64 zufällig (Werte aus hiMedia.js). null = Bildschirmschoner aus.
  // zoom: langsamer Zoom je Bild über das Bildfenster des Players (bleibt 4K): startet zufällig
  // links oder rechts vergrößert (from) und wandert über die Standzeit zur Mitte (to);
  // stepMs = Abstand der Schritte, z. B. { from: 1.10, to: 1.18, stepMs: 66 }. null = ohne Zoom
  // (Standard; am TV getestet und nicht gewünscht).
  var SCREENSAVER = { idleSec: 60, wallpaperSec: 30, slideSec: 20, effect: 64, zoom: null };

  // Wallpaper und eigene Kachelbilder sofort laden, damit sie beim ersten Öffnen der Startseite
  // schon dekodiert sind (gleiche URLs wie in flex.css/mainTileData -> derselbe Cache-Eintrag)
  inst.preload = [];
  ['static/flex/wallpaper.webp', KODI_TILE.img, SOURCES_TILE.img, IMG_OVERRIDE['-3'], GALLERY_TILE.img].forEach(function (u) {
    var im = new Image();
    im.src = u;
    inst.preload.push(im);
  });

  function every(fn, ms) {
    var id = setInterval(function () {
      if (inst.stopped) return;
      try { fn(); } catch (e) { log('Fehler: ' + e); }
    }, ms);
    inst.timers.push(id);
  }

  function later(fn, ms) {
    var id = setTimeout(function () {
      if (inst.stopped) return;
      try { fn(); } catch (e) { log('Fehler: ' + e); }
    }, ms);
    inst.timers.push(id);
  }

  // Optional bounded logging to the launcher's local data directory.
  var DBG_DIR = 'flexdbg/';
  var logBuf = (prev && prev.logBuf) || [];
  window.__flex.logBuf = logBuf;

  function rd(name) {
    try {
      var r = window.hisense.file.read(DBG_DIR + name, 1);
      return typeof r === 'string' ? r : null;
    } catch (e) {
      return null;
    }
  }

  function wr(name, text) {
    try { window.hisense.file.write(DBG_DIR + name, text, 1); } catch (e) { /* ignorieren */ }
  }

  var debug = rd('enable') !== null;

  function two(n) { return (n < 10 ? '0' : '') + n; }

  function log(msg) {
    if (!debug) return;
    // Uhrzeit statt Laufzeit: beim Kaltstart springt die Systemuhr erst nach dem Start auf NTP-Zeit
    var d = new Date();
    logBuf.push(two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()) + ' ' + msg);
    if (logBuf.length > 80) logBuf.shift();
    wr('log.txt', logBuf.join('\n'));
  }

  // ---- App-Filter ----
  function norm(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, '');
  }

  function rank(app) {
    for (var i = 0; i < KEEP.length; i++) {
      if (String(app.appId) === KEEP[i].id || norm(app.appName) === KEEP[i].name) return i;
    }
    return -1;
  }

  function ids(list) {
    var out = [];
    for (var i = 0; i < (list || []).length; i++) out.push(String(list[i].appId));
    return out.join(',');
  }

  // Das Startseiten-Modul ist der Namespace "LauncherHis/" (= state.LauncherHis). Achtung:
  // state.modules.LauncherHis ist ein ANDERES Modul (Suche, "modules/LauncherHis/").
  function launcherState(store) {
    var m = store._modulesNamespaceMap && store._modulesNamespaceMap['LauncherHis/'];
    var st = m && m.context ? m.context.state : (store.state || {}).LauncherHis;
    return st && st.mainTileData ? st : null;
  }

  // Eintrag "Bilder" ans Ende von "Alle Apps" (der Launcher baut allAppsData beim Aktualisieren
  // neu auf, darum bei jeder Änderung prüfen)
  function ensureGalleryApp(st) {
    var src = st.allAppsData;
    if (!src || !src.length) return;
    for (var i = 0; i < src.length; i++) if (src[i] && src[i].appId === GALLERY_TILE.appId) return;
    src.push(JSON.parse(JSON.stringify(GALLERY_TILE)));
    log('Eintrag Bilder in Alle Apps ergänzt');
  }

  function filterTiles(st) {
    ensureGalleryApp(st);
    if (st.allAppsData && st.allAppsData.length) {
      var hasDenon = false;
      for (var di = 0; di < st.allAppsData.length; di++) if (st.allAppsData[di].appId === DENON_TILE.appId) hasDenon = true;
      if (!hasDenon) st.allAppsData.push(JSON.parse(JSON.stringify(DENON_TILE)));
    }
    var src = st.allAppsData || [];
    var slot = [];
    for (var i = 0; i < src.length; i++) {
      var r = rank(src[i]);
      if (r >= 0 && !slot[r]) slot[r] = src[i];
    }
    if (!slot.length || !st.mainTileData) return; // App-Liste noch nicht geladen -> Original lassen
    slot[KEEP.length - 1] = slot[KEEP.length - 1] || MYAPPS_TILE;
    // Reihenfolge: Kodi, die Apps, Quellen, Alle Apps (Wunsch des Besitzers 2026-10-28)
    var keep = [KODI_TILE].concat(denonHomeTiles());
    for (var k = 0; k < KEEP.length - 1; k++) if (slot[k]) keep.push(slot[k]);
    keep.push(SOURCES_TILE, slot[KEEP.length - 1]);
    var oldNames = st.mainTileData.map(function(t){return t.appName;}).join('|');
    var newNames = keep.map(function(t){return t.appName;}).join('|');
    if (ids(st.mainTileData) === ids(keep) && oldNames === newNames) return;
    var focusVm = mainTilesVm(), oldFocus = focusVm && String(focusVm.componentFocus || '');
    var oldIndex = parseInt(String(oldFocus).split('-')[1],10);
    var oldId = st.mainTileData[oldIndex] && st.mainTileData[oldIndex].appId;
    var copy = JSON.parse(JSON.stringify(keep));
    for (var c = 0; c < copy.length; c++) {
      copy[c].visibility = '';
      if (IMG_OVERRIDE[String(copy[c].appId)]) copy[c].img = IMG_OVERRIDE[String(copy[c].appId)];
    }
    st.mainTileData.splice.apply(st.mainTileData, [0, st.mainTileData.length].concat(copy));
    if (oldId && focusVm && oldFocus.indexOf('LauncherMainTile-') === 0) {
      var retained = false;
      for (var fi=0;fi<copy.length;fi++) if(copy[fi].appId===oldId) {
        focusVm.changeMainTileListIndex(fi);focusVm.$emit('changeFocus','LauncherMainTile-'+fi);retained=true;break;
      }
      if(!retained){var nearest=Math.max(0,Math.min(oldIndex,copy.length-1));focusVm.changeMainTileListIndex(nearest);focusVm.$emit('changeFocus','LauncherMainTile-'+nearest);}
    }
    log('gefiltert: ' + ids(st.mainTileData) + ' (aus ' + src.length + ' Apps)');
    preloadTiles(copy);
  }

  // ---- Startseite erst zeigen, wenn sie komplett fertig ist ----
  // Beim Kaltstart baut sich die Oberfläche sichtbar auf (Hintergrund, leere Kacheln, Logos
  // einzeln), weil der Launcher jedes Bild erst beim Zeichnen lädt und die CPU ausgelastet ist.
  // Solange zeigt der Ladebildschirm #flex-loading (steht in index.html, siehe flex.css); die
  // Startseite bleibt per <style id="flex-hold"> unsichtbar, bis sie im DOM steht und alle
  // Kachelbilder geladen sind, dann Überblendung. Nur beim Kaltstart; läuft flex.js nicht, gibt
  // es keinen Hold-Style und der Ladebildschirm geht nach 45 s per CSS weg.
  var tileImgs = {};
  var holdDone = !!prev;
  var bootHome = false;  // dieser Start geht zur Startseite (Live-TV abgefangen)

  function holdHome() {
    if (holdDone || document.getElementById('flex-hold')) return;
    var s = document.createElement('style');
    s.id = 'flex-hold';
    s.textContent = '.launcher[data-v-81590a38]{opacity:0 !important}';
    (document.head || document.documentElement).appendChild(s);
    // Zeitlimit 14 s ab Öffnen der Startseite (showHomeAtBoot); hier nur der äußerste Notnagel
    later(function () { releaseHome('Notnagel'); }, 40000);
    // während des Haltens öfter prüfen als im 1-s-Takt
    (function fast() {
      if (holdDone || inst.stopped) return;
      checkHomeReady();
      inst.timers.push(setTimeout(fast, 200));
    })();
  }

  function releaseHome(why) {
    if (holdDone) return;
    holdDone = true;
    var s = document.getElementById('flex-hold');
    if (s && s.parentNode) s.parentNode.removeChild(s);
    log('Startseite eingeblendet (' + why + ')');
    hideLoading();
  }

  function hideLoading() {
    var d = document.getElementById('flex-loading');
    if (!d || d.className === 'fl-out') return;
    d.className = 'fl-out'; // Überblendung per CSS-Transition (0.5 s)
    later(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 800);
  }

  // Hinweis Boot-Animation: systemserver (ApplicationManager::stopAnimation) beendet
  // /usr/local/bin/boot_animation über die Semaphore GUICLOSE ~11 s nach dem Start von hisenseUI,
  // unabhängig von modeljs.system.setGuiLoopFinished (getestet: Zurückhalten ändert nichts).
  // Die Lücke danach deckt der Ladebildschirm #flex-loading ab.

  // Eigene Merker per onload: Cobalts HTMLImageElement hat keine Eigenschaft "complete"
  function preloadTiles(list) {
    for (var i = 0; i < list.length; i++) {
      var u = list[i].img;
      if (!u || tileImgs[u]) continue;
      var rec = { done: false, im: new Image() };
      rec.im.onload = rec.im.onerror = (function (r) {
        return function () { r.done = true; checkHomeReady(); };
      })(rec);
      tileImgs[u] = rec;
      rec.im.src = u;
    }
    checkHomeReady();
  }

  var waitReason = '';
  var waitLoggedAt = 0;

  function waitingFor(reason) {
    // nur mit Debug und höchstens einmal pro Sekunde bzw. bei Änderung protokollieren
    var now = Date.now();
    if (reason !== waitReason || now - waitLoggedAt > 1000) {
      waitReason = reason;
      waitLoggedAt = now;
      log('warte auf: ' + reason);
    }
  }

  function checkHomeReady() {
    if (holdDone || !window.UI || !window.UI.store) return;
    var st = launcherState(window.UI.store);
    if (!st || !st.mainTileData.length) return waitingFor('Kacheldaten');
    // Startseite muss wirklich im DOM stehen, mit allen Kacheln
    if (!document.querySelector('.launcher')) return waitingFor('Startseite im DOM');
    var n = document.querySelectorAll('.mainTileItem').length;
    if (n < st.mainTileData.length) return waitingFor('Kacheln im DOM (' + n + '/' + st.mainTileData.length + ')');
    for (var i = 0; i < st.mainTileData.length; i++) {
      var rec = tileImgs[st.mainTileData[i].img];
      if (!rec) return waitingFor('Bild nicht vorgeladen: ' + st.mainTileData[i].img);
      if (!rec.done) return waitingFor('Bild lädt: ' + st.mainTileData[i].img);
    }
    // kurz warten, bis der Launcher die Bilder aus dem Cache in die Kacheln gesetzt hat
    later(function () { releaseHome('fertig aufgebaut'); }, 300);
  }

  // ---- Empfehlungen/Werbung von der Startseite entfernen ----
  // a) Empfehlungsreihen unter den Apps (ListTemplateData) leer halten, über die launchereigene
  //    Mutation. Asynchroner Watcher, weil der Launcher die Reihen teils per Index befüllt.
  // b) Reihe über den Apps aus: appRecommendDataFlag=false (Pfeil-runter aus der Statusleiste
  //    geht direkt zu den Apps) und MainTiles.appRecommendList = [] (fällt sonst auf ein fest
  //    eingebautes Banner zurück). flex.css blendet die Bereiche zusätzlich aus (kein Aufblitzen).
  function cleanHome(store, st) {
    if (st.appRecommendDataFlag) st.appRecommendDataFlag = false;
    if (st.ListTemplateData && st.ListTemplateData.length) {
      store.commit('LauncherHis/clearAllWaterFallData');
      log('Empfehlungsreihen geleert');
    }
  }

  // MainTiles-Instanz anpassen: Empfehlungszeile aus, eigene Tasten (Quellen-Kachel, 8 Kacheln
  // in einer Reihe). Originale bleiben in vm.__flexOrig, damit stop() sie zurücksetzen kann.
  function mainTilesVm() {
    var el = document.querySelector('.mainTiles');
    return el && el.__vue__;
  }

  function patchMainTiles() {
    var vm = mainTilesVm();
    if (!vm || vm.__flexInst === inst || !vm._computedWatchers || !vm._computedWatchers.appRecommendList) return;
    var w = vm._computedWatchers;
    if (!vm.__flexOrig) vm.__flexOrig = { keydown: vm.keydown, recGetter: w.appRecommendList.getter };
    w.appRecommendList.getter = function () { return []; };
    w.appRecommendList.dirty = true;
    if (w.appRecommendDataLen) w.appRecommendDataLen.dirty = true;
    if (w.listTop) w.listTop.dirty = true;
    vm.keydown = function (e) {
      var r;
      try { r = handleTileKey(vm, e); } catch (err) { log('Tastenfehler: ' + err); }
      return r === undefined ? vm.__flexOrig.keydown.apply(vm, arguments) : r;
    };
    vm.__flexInst = inst;
    vm.$forceUpdate();
    log('MainTiles angepasst');
  }

  // Seite "Alle Apps" (AllApps.vue, Route /LauncherHis/Apps/AllApps, Chunk 100.js): OK auf unserem
  // Eintrag öffnet die Seite "Bilder". Über den originalen Startpfad darf er nie laufen
  // (AllApps.keydown -> ENTER -> startThirdPartyApp mit leerer URL, 100.js L537-556; Audit
  // Risiko 5, Schutzregel 8). Darum zweifach:
  // 1. onKey() behandelt OK auf dem Eintrag synchron in der Capture-Phase, bevor der Launcher die
  //    Taste sieht. Das reicht im Normalbetrieb allein.
  // 2. keydown der Komponente ist umhüllt (allAppsKey): einmalig in den Komponenten-Optionen
  //    (vm.constructor.options.methods; Vue 2.6.10 bindet methods beim Anlegen JEDER Instanz
  //    daraus, vendor.dll.js initMethods), damit jede neue Instanz schon beim Entstehen geschützt
  //    ist -- früher war jede neue Instanz bis zum nächsten 1-s-Takt ungeschützt --, und für die
  //    Instanz, die beim ersten Fund schon offen ist. Die Hülle fängt nur OK auf unserem Eintrag
  //    ab (und alle Tasten, solange die Seite offen ist); alles andere geht unverändert ans Original.
  var allAppsRef = null;

  function allAppsVm() {
    // Wurzel-div von AllApps.vue hat id "AllApps" (100.js L609-610); teilt sich eine Hülle
    // (keep-alive) das Element, zeigt __vue__ auf die Hülle -> über _vnode.componentInstance absteigen
    var el = document.getElementById('AllApps');
    var v = el && el.__vue__;
    for (var d = 0; v && d < 4; d++) {
      if (v.$options && v.$options.name === 'AllApps') return v._isDestroyed ? null : v;
      v = v._vnode && v._vnode.componentInstance;
    }
    var all = document.querySelectorAll('div');
    for (var i = 0; i < all.length; i++) {
      var w = all[i].__vue__;
      if (w && w.$options && w.$options.name === 'AllApps' && !w._isDestroyed) return w;
    }
    return null;
  }

  // Fokussierter Eintrag wie im Original: allAppsData[<n> aus currentFocus "AllAppsTile-<n>"]
  // (100.js L491), nur im normalen Modus (EditStatus 0; 1/2 = Bearbeiten/Sortieren)
  function isGalleryEntry(vm) {
    if (!vm || vm.EditStatus !== 0) return false;
    var it = vm.allAppsData && vm.allAppsData[parseInt(String(vm.currentFocus).split('-')[1], 10)];
    return !!it && it.appId === GALLERY_TILE.appId;
  }

  function isDenonEntry(vm) {
    if (!vm || vm.EditStatus !== 0) return false;
    var it = vm.allAppsData && vm.allAppsData[parseInt(String(vm.currentFocus).split('-')[1], 10)];
    return !!it && it.appId === DENON_TILE.appId;
  }

  // OK auf "Bilder", und nur wenn "Alle Apps" wirklich vorne ist (kein Dialog davor)
  function galleryEntryFocused() {
    try {
      if (window.UI.getCurrentSubModuleId() !== 'AllApps' || !uiReadyNow() || dialogUp()) return false;
      return isGalleryEntry(allAppsVm());
    } catch (e) {
      return false;
    }
  }

  // Die Seite "Bilder" gilt nur, solange "Alle Apps" das aktuelle Submodul ist, der Launcher bereit
  // ist, kein Dialog offen ist und kein AppControl existiert (Risiko 4, Schutzregeln 5 und 6).
  // Bewusst NICHT appFree(): die Seite berührt weder Quelle noch Player noch Modul-Stapel. Ein nur
  // im Hintergrund pausiertes YouTube/Netflix (runningOnBack*, bleibt nach jedem Verlassen stehen)
  // oder ein veraltetes openFromNetflix machte den Eintrag sonst dauerhaft tot.
  function galleryValid() {
    try {
      var UI = window.UI;
      return UI.getCurrentSubModuleId() === 'AllApps' && uiReadyNow() && !dialogUp() &&
        !UI.isSubModuleExist('AppControl', 'AppControl') && !UI.isModuleExist('AppControl');
    } catch (e) {
      return false;
    }
  }

  // Hülle um AllApps.keydown (this/vm = die Instanz)
  function allAppsKey(vm, orig, args) {
    var e = args[0];
    var dn = window.__flexDenon;
    if (e && e.keyCode === 13 && isDenonEntry(vm)) {
      if (!inst.stopped && !e.repeat && dn && !dn.isOpen() && galleryValid()) dn.open();
      return true;
    }
    if (!inst.stopped && dn && dn.isOpen()) {
      if (dn.isTyping && dn.isTyping()) return orig.apply(vm,args);
      if (!galleryValid()) dn.close();
      else if (e && (SS_PASS_KEYS[e.keyCode] === 1 || SYS_KEYS[e.keyCode] === 1)) {
        if (e.keyCode !== 411 && e.keyCode !== 412 && e.keyCode !== 413) dn.close();
        return orig.apply(vm, args);
      } else return true;
    }
    var ours = false;
    try { ours = !!e && e.keyCode === 13 && isGalleryEntry(vm); } catch (err) { ours = false; }
    if (ours) {
      // nie ans Original, auch nicht nach stop() einer alten Instanz, deren Hülle noch gebunden ist
      if (!inst.stopped && !e.repeat && !gal.open) {
        try {
          if (galleryValid()) openGallery(13);
        } catch (err2) { log('Bilder-Fehler: ' + err2); }
      }
      return true;
    }
    if (!inst.stopped && gal.open) return true;
    return orig.apply(vm, args);
  }

  function patchAllApps() {
    var UI = window.UI;
    if (!UI || UI.getCurrentSubModuleId() !== 'AllApps') return;
    if (allAppsRef && !allAppsRef._isDestroyed && allAppsRef.__flexInst === inst) return;
    allAppsRef = null;
    var vm = allAppsVm();
    if (!vm) return;
    allAppsRef = vm;
    // einmalig: Komponenten-Optionen (gilt für jede künftige Instanz ab ihrem Entstehen)
    var m = vm.constructor && vm.constructor.options && vm.constructor.options.methods;
    if (m && typeof m.keydown === 'function' && m.keydown.__flexInst !== inst) {
      var origM = m.keydown.__flexOrig || m.keydown;
      var wrapM = function () { return allAppsKey(this, origM, arguments); };
      wrapM.__flexOrig = origM;
      wrapM.__flexInst = inst;
      m.keydown = wrapM;
      inst.allAppsMethods = m;
      log('Alle Apps: Komponente angepasst');
    }
    if (vm.__flexInst === inst) return;
    // diese Instanz (entstand evtl. vor der Anpassung oben; doppelt umhüllt schadet nicht)
    var origI = vm.__flexOrigKeydown || vm.keydown;
    vm.__flexOrigKeydown = origI;
    vm.keydown = function () { return allAppsKey(vm, origI, arguments); };
    vm.__flexInst = inst;
    log('Alle Apps angepasst');
  }

  function unpatchAllApps() {
    if (allAppsRef && allAppsRef.__flexInst === inst && allAppsRef.__flexOrigKeydown) {
      allAppsRef.keydown = allAppsRef.__flexOrigKeydown;
      allAppsRef.__flexInst = null;
    }
    allAppsRef = null;
    var m = inst.allAppsMethods;
    if (m && m.keydown && m.keydown.__flexInst === inst) m.keydown = m.keydown.__flexOrig;
    inst.allAppsMethods = null;
  }

  function unpatchMainTiles() {
    var vm = mainTilesVm();
    if (!vm || !vm.__flexOrig) return;
    vm.keydown = vm.__flexOrig.keydown;
    var w = vm._computedWatchers;
    w.appRecommendList.getter = vm.__flexOrig.recGetter;
    w.appRecommendList.dirty = true;
    if (w.appRecommendDataLen) w.appRecommendDataLen.dirty = true;
    if (w.listTop) w.listTop.dirty = true;
    vm.__flexInst = null;
    vm.$forceUpdate();
  }

  // MainTiles rechnet fest mit 7 Kacheln pro Reihe (Pfeil-runter springt +7). Unsere 8 Kacheln
  // stehen per flex.css in einer Reihe, also: runter = nichts, hoch = Statusleiste.
  // Rückgabe true = Taste verbraucht: UI.js gibt sie dann nicht weiter und quittiert sie selbst
  // genau einmal (ve() -> Ce() -> guiService.sendResult, app.js L9745-9761); undefined = Original.
  function handleTileKey(vm, e) {
    // Bildschirmschoner aktiv: Taste nur zum Aufwecken (greift, falls der Launcher-Handler vor
    // onKey läuft, z. B. nach einem Hot-Reload)
    if (ss.state !== 'off' || gal.open) return true;
    // Kachel-Menü offen (Einstellungstaste): es bekommt alle Tasten zuerst
    if (tm.open) return tileMenuKey(vm, e);
    // Konsolen-Reihe offen (Denon-Modul, openDenonGroup): sie bekommt alle Tasten zuerst
    if (dg.open) return denonGroupKey(vm, e);
    var K = window.CONST && window.CONST.KEY;
    var focus = String(vm.componentFocus || '');
    if (!K || focus.indexOf('LauncherMainTile') !== 0) return undefined;
    var st = launcherState(window.UI.store);
    var idx = parseInt(focus.split('-')[1], 10);
    var tile = st && st.mainTileData[idx];
    // Messhilfe (nur mit Debug): Code jeder anderen Taste auf einer Kachel, z. B. der Einstellungstaste
    if (debug && !e.repeat && e.keyCode !== 13 && (e.keyCode < 37 || e.keyCode > 40)) {
      log('Kachel ' + idx + ': Taste ' + e.keyCode);
    }
    if (e.keyCode === K.VK_ENTER && tile && tile.denonPort) {
      if (!e.repeat) chooseDenonSource(tile.denonPort);
      return true;
    }
    if (e.keyCode === K.VK_ENTER && tile && tile.denonGroup) {
      if (!e.repeat) openDenonGroup(idx, focus);
      return true;
    }
    if ((e.keyCode === K.VK_LEFT || e.keyCode === K.VK_RIGHT) && st && st.mainTileData.length > 9) {
      var next = Math.max(0,Math.min(st.mainTileData.length-1,idx+(e.keyCode===K.VK_RIGHT?1:-1)));
      vm.changeMainTileListIndex(next);vm.$emit('changeFocus','LauncherMainTile-'+next);
      later(sourceCarousel,0);return true;
    }
    if (e.keyCode === K.VK_ENTER && tile && tile.appId === 'flex-sources') {
      openSources();
      return true;
    }
    if (e.keyCode === K.VK_ENTER && tile && tile.appId === 'flex-kodi') {
      // OK auf Kodi, während die Hintergrund-Apps noch freigegeben werden bzw. die App unter der
      // Startseite beendet wird (bgc.app): nur verbrauchen, kein zweiter Start. Dass es nicht als
      // fremde Taste zählt, regelt onKey (kodiTileFocused): dort kommen auch die Wiederholungen an,
      // die UI.js nie an MainTiles weitergibt. Nur dieses direkte OK (keine Wiederholung) darf
      // startKodi und damit uhStart auslösen (Ausnahme von Schutzregel 4, 08.11.2026).
      // Denon-Modul (denonBeforeStart): verwirft eine laufende Konsolenwahl und stellt den Denon auf TV-Ton; ist der Denon
      // nach einer verworfenen Wahl noch nicht zurück, startet es Kodi selbst, sobald er es ist (sonst sofort wie bisher).
      // Dieser verzögerte Start (Zeitgeber) ist nur der einfache: App unter der Startseite beenden (uhStart/uhRearm),
      // Hintergrund-Apps freigeben oder verwaistes DMP übernehmen nur auf ein direktes OK (Review 18.11.2026)
      if (!(bgc && bgc.kodi) && !e.repeat &&
        !denonBeforeStart('Kodi', function () {
          var bm = bgMarks();
          if (bgc || !noAppInStack() || (bgAny(bm) && !bgCovered(bm)) || (appFree() && dmpOrphan())) {
            log('Kodi: verzögerter Start nur auf direktes OK');
            kodiToast('Kodi: bitte noch einmal wählen', 4000);
            return;
          }
          startKodi();
        })) startKodi();
      return true;
    }
    // Einstellungstaste auf einer App-Kachel: Menü "App schließen", nur wenn es etwas zu tun gibt
    // (sonst TV-Einstellungen wie ohne Mod, eigene Kacheln ebenso)
    // OK auf einer App-Kachel: das Denon-Modul verwirft eine laufende Konsolenwahl und stellt den Denon auf TV-Ton; die Taste
    // geht unverändert weiter. Nur wenn deren Eingangswechsel schon unterwegs war, kommt dieses OK erst danach an MainTiles
    // (gleiche Kachel, keine Taste dazwischen), damit der CEC-Sprung des Launchers die App nicht gleich wieder beendet
    // (denonBeforeStart prüft vorher Taste, Fokus und launcherSig: kein App-Start dazwischen, auch keiner ohne Taste)
    if (e.keyCode === K.VK_ENTER && !e.repeat && tile && tileApp(tile)) {
      var okEv = e, okApp = tile.appId, okName = String(tile.appName || 'App');
      if (denonBeforeStart(okName, function () {
        var v2 = mainTilesVm(), st2 = launcherState(window.UI.store), t2 = st2 && st2.mainTileData[idx];
        if (v2 && v2.__flexInst === inst && v2.__flexOrig && t2 && t2.appId === okApp) v2.__flexOrig.keydown.call(v2, okEv);
        else { log('Denon: verzögerter Start von ' + okName + ' nicht möglich (Startseite neu aufgebaut)'); kodiToast(okName + ': bitte noch einmal wählen', 4000); }
      })) return true;
    }
    if (isTileMenuKey(e.keyCode) && !e.repeat && tile && openTileMenu(tile, idx, focus)) return true;
    if (e.keyCode === K.VK_DOWN) return true;
    if (e.keyCode === K.VK_UP && st && st.currentRowIndex === 2) {
      window.UI.store.commit('LauncherHis/setCurrentRowIndex', [-1, 2]);
      return true;
    }
    return undefined;
  }

  function openSources() {
    log('Quellen geöffnet');
    window.UI.pushSubModule('LauncherHis', 'AllInputs', { caller: 'LauncherMain' },
      { path: '/LauncherHis/Source/AllInputs' });
  }

/* BEGIN FLEX DENON SOURCES */
/* Included INSIDE flex.js closure. Native TV inputs retain their original handlers. */
  var denonInputRef = null, denonInputMethods = null, sourceOffset = 0, sourceLayout = '';
  function denonSources() {return window.__flexDenon ? window.__flexDenon.state().sources || [] : [];}
  // Ein Denon-Eingang erscheint, sobald der Denon dort ein Geraet kennt (Name per CEC bzw. HDMI-Kennung,
  // "Auto" in seiner Namensliste) oder der Besitzer ihm einen Namen gegeben hat. Das gilt auch im Ruhemodus
  // des Geraets und ohne IP-Abfrage (17.11.2026). Ob gerade ein Bild kommt, zeigt nur der Status.
  // Name "-" (hidden) blendet einen Eingang aus, auch wenn der Denon dort noch einen alten Geraetenamen kennt.
  function denonSourceListed(s){return !!(s&&!s.hidden&&(s.autoName||s.label));}
  // ---- Kachel "Konsolen" (Wunsch des Besitzers 17.11.2026) ----
  // Statt je einer Kachel pro Denon-Geraet eine Kachel "Konsolen"; OK oeffnet darueber eine Reihe mit den Geraeten.
  // Gebaut wie das Kachel-Menue (openTileMenu): eigenes DOM ueber der Startseite, Tasten ueber handleTileKey, gilt nur,
  // solange die Startseite vorne und frei ist und die Kachel den Fokus hat (Schutzregeln 5/6). Es verbraucht nur die
  // eigenen Tasten (Pfeile, OK, Zurueck); jede andere Taste schliesst und geht unveraendert weiter. In "Quellen"
  // stehen die Geraete weiter einzeln.
  var DENON_GROUP_TILE={appName:'Konsolen',appId:'flex-denon-group',uid:'flex-denon-group',cmd:6,url:'',img:'static/flex/tile-denon-source.png',appReList:[],visibility:'',denonGroup:true};
  var DG_STEP=260,dg={open:false,el:null,items:[],idx:0,focus:'',hard:0};
  function denonListedSources(){var out=[],src=denonSources();for(var i=0;i<src.length;i++)if(denonSourceListed(src[i]))out.push(src[i]);return out;}
  function denonHomeTiles(){return denonListedSources().length?[DENON_GROUP_TILE]:[];}
  function denonGroupState(s){
    var st='';try{st=window.__flexDenon.sourceStatus(s);}catch(e){st='';}
    return st.indexOf('Signal ')===0?'Bild '+st.substr(7):st==='Ausgewaehlt'?'am Denon gewählt':'';
  }
  function renderDenonGroup(){
    for(var i=0;i<dg.items.length;i++){var c='dg-tile'+(i===dg.idx?' focus':'');if(dg.items[i].el.className!==c)dg.items[i].el.className=c;}
  }
  function openDenonGroup(idx,focus){
    if(dg.open||tm.open)return false;
    if(!homeIdle()||!uiReadyNow()||dialogUp()||ss.state!=='off'||gal.open)return false;
    var list=denonListedSources();if(!list.length)return false;
    var el=document.createElement('div');el.id='flex-denon-group';
    // ueber der Kachel: sichtbare Kachel n hat ihre Mitte bei 160 + 200 * n px (wie das Kachel-Menue), sourceOffset
    // ist die Verschiebung des Karussells
    var w=40+list.length*DG_STEP,center=160+200*(idx-sourceOffset);
    el.style.width=w+'px';el.style.left=Math.max(40,Math.min(1920-40-w,center-w/2))+'px';
    var t=document.createElement('div');t.className='dg-title';t.textContent='Konsolen';el.appendChild(t);
    dg.items=[];
    for(var i=0;i<list.length;i++){
      var it=document.createElement('div');it.className='dg-tile';it.style.left=(20+i*DG_STEP)+'px';
      var n=document.createElement('div');n.className='dg-name';n.textContent=list[i].name;it.appendChild(n);
      var st=document.createElement('div');st.className='dg-state';st.textContent=denonGroupState(list[i]);it.appendChild(st);
      el.appendChild(it);dg.items.push({el:it,state:st,port:list[i].port,name:list[i].name});
    }
    var h=document.createElement('div');h.className='dg-hint';h.textContent='OK: einschalten · Zurück: schließen';el.appendChild(h);
    (document.body||document.documentElement).appendChild(el);
    dg.el=el;dg.open=true;dg.idx=0;dg.focus=String(focus||'');dg.hard=fx.hard;renderDenonGroup();
    log('Konsolen-Reihe offen ('+list.length+' Geraete)');
    return true;
  }
  function closeDenonGroup(why){
    if(!dg.open)return;
    dg.open=false;if(dg.el&&dg.el.parentNode)dg.el.parentNode.removeChild(dg.el);
    dg.el=null;dg.items=[];log('Konsolen-Reihe geschlossen ('+why+')');
  }
  function denonGroupValid(vm){
    return dg.hard===fx.hard&&homeIdle()&&uiReadyNow()&&!dialogUp()&&ss.state==='off'&&!gal.open&&!!vm&&String(vm.componentFocus||'')===dg.focus;
  }
  function checkDenonGroup(){   // 1-s-Takt: gueltig halten und den Status der Geraete nachfuehren
    if(!dg.open)return;
    if(!denonGroupValid(mainTilesVm())){closeDenonGroup('Startseite nicht mehr frei');return;}
    var src=denonSources();
    for(var i=0;i<dg.items.length;i++)for(var j=0;j<src.length;j++)if(src[j].port===dg.items[i].port){var t=denonGroupState(src[j]);if(dg.items[i].state.textContent!==t)dg.items[i].state.textContent=t;}
  }
  // Taste bei offener Reihe (aus handleTileKey): true = verbraucht, undefined = Original (Reihe ist dann zu)
  function denonGroupKey(vm,e){
    var k=e.keyCode;
    if(!denonGroupValid(vm)){closeDenonGroup('Startseite nicht mehr frei');return undefined;}
    if(isTileMenuKey(k)){if(e.repeat)return true;closeDenonGroup('Einstellungstaste');return undefined;}
    if(SS_PASS_KEYS[k]===1)return undefined;            // Power, Lautstaerke, Stumm wie immer, Reihe bleibt
    if(TM_BACK[k]===1||k===40){if(!e.repeat)closeDenonGroup('Taste '+k);return true;}
    if(k===37||k===39){var n=dg.idx+(k===39?1:-1);if(n>=0&&n<dg.items.length){dg.idx=n;renderDenonGroup();}return true;}
    if(k===38)return true;
    if(k===13){
      if(!e.repeat){var it=dg.items[dg.idx];closeDenonGroup('Auswahl '+(it?it.name:''));if(it)chooseDenonSource(it.port);}
      return true;
    }
    closeDenonGroup('Taste '+k);return undefined;
  }
  function inputVm() {
    // Vue keep-alive can own the root DOM node; the rendered component is in _vnode.
    function rendered(v){for(var depth=0;v&&depth<6;depth++){
      if(v.$options&&v.$options.name==='AllInputs'&&!v._isDestroyed&&!v._inactive)return v;
      v=v._vnode&&v._vnode.componentInstance;
    }return null;}
    var root=document.getElementById('AllInputs'),current=root&&rendered(root.__vue__);if(current)return current;
    var all=document.querySelectorAll('div');
    for(var i=0;i<all.length;i++){var v=rendered(all[i].__vue__);if(v)return v;}
    return null;
  }
  function focusedDenonInput(vm){
    if(!vm||vm.showMenu)return null;
    var n=parseInt(String(vm.currentFocus).split('-')[1],10),it=vm.allInputsData&&vm.allInputsData[n];
    return it&&it.denonPort?it:null;
  }
  // Weckt das Geraet am Denon-Eingang mit dem TV-eigenen CEC-Befehl "Start" (Einstellungen > System > HDMI & CEC >
  // CEC-Geraeteliste > Geraet > Start ruft HdmiDevicesOperate([0, Typ]), 309.js Cec2Enter). Am TV geprueft 17.11.2026:
  // weckt die PS5 aus dem Ruhemodus, eine laufende PS5 bleibt an. Der Befehl adressiert nach Geraetetyp, darum nur,
  // wenn der Denon dort einen Geraetenamen kennt, der TV genau dieses Geraet per CEC kennt und kein zweites Geraet
  // desselben Typs; nie an TV (0) oder Audiosystem (5). Im Zweifel nichts senden.
  // Typ des Geraets an diesem Denon-Eingang, wenn der TV genau dieses Geraet per CEC kennt und kein zweites Geraet
  // desselben Typs (HdmiDevicesOperate adressiert nach Typ); sonst der Grund als Text. Nie TV (0) oder Audiosystem (5).
  function cecDeviceType(s){
    if(!s||!s.autoName)return 'kein Geraetename';
    var cec=window.modeljs&&window.modeljs.cec;if(!cec||typeof cec.HdmiDevicesOperate!=='function')return 'kein CEC';
    var names=cec.getHdmiDevicesName()||[],types=cec.getHdmiDevicesType()||[],hit=-1,i;
    for(i=0;i<names.length;i++)if(String(names[i]).replace(/^HDMI[0-9]+-/,'')===s.autoName)hit=i;
    if(hit<0)return 'nicht in der CEC-Liste';
    var t=types[hit],same=0;for(i=0;i<types.length;i++)if(types[i]===t)same++;
    if(typeof t!=='number'||t===0||t===5||same!==1)return 'Typ '+t+' nicht eindeutig';
    return t;
  }
  function cecStartDevice(port){
    try{
      var src=denonSources(),s=null,i;for(i=0;i<src.length;i++)if(src[i].port===port)s=src[i];
      var t=cecDeviceType(s);if(typeof t!=='number')return t;
      window.modeljs.cec.HdmiDevicesOperate([0,t]);log('Denon: CEC-Start an '+s.autoName+' (Typ '+t+')');return 'gesendet';
    }catch(e){return 'Fehler: '+e;}
  }
  // Nach dem bestaetigten Denon-Wechsel den CEC-Start noch einmal senden (am TV geprueft: eine laufende PS5 bleibt an),
  // falls der erste beim OK nicht ankam. Eine Startanzeige gibt es bewusst nicht: die PS5 ist meist schneller in der
  // Benutzerauswahl, als der Denon ihr Bild meldet (Besitzer 17.11.2026, Anzeige wieder entfernt).
  function afterDenonSwitch(port){inst.sourceSwitch.cec=cecStartDevice(port);}
  // ---- Kein Bild am gewaehlten Eingang (18.11.2026: Xbox gewaehlt, die nicht angeschlossen ist -> kein Bild, kein Ton) ----
  // Nach jedem bestaetigten Wechsel des Denon auf ein Geraet: kommt innerhalb von SIG_WAIT_* kein Bild (der Denon meldet
  // "Signal ..."), zurueck auf TV-Ton mit kleinem Hinweis. Der TV bleibt, wo er ist (Schutzregel 4: keine Modulwechsel
  // per Zeitgeber); HOME fuehrt zur Startseite. Aus, sobald ein Bild kommt, der Denon einen anderen Eingang hat oder eine
  // neue Wahl kommt. Geweckte Konsolen (CEC-Start, PS5 braucht bis ~20 s) bekommen laenger.
  // Review 18.11.2026: entschieden wird erst auf einer Statusabfrage nach Fristende (sonst auf einem bis zu 5 s alten
  // Stand); Standby/Neustart dazwischen (fx.hard) beendet die Pruefung; die TV-Anfrage prueft bei der Ausfuehrung noch
  // einmal, ob der Denon weiter auf diesem Geraet steht (ein inzwischen gewaehltes Profil bleibt).
  var SIG_WAIT_CEC_MS=40000,SIG_WAIT_MS=20000,SIG_POLL_MS=5000,SIG_LAST_MS=12000,sigWatch=null;
  function hint(text,ms){try{kodiToast(text,ms);}catch(e){}}
  function stopSignalWatch(){sigWatch=null;}
  function startSignalWatch(port,woken){
    var src=denonSources(),s=null,i;for(i=0;i<src.length;i++)if(src[i].port===port)s=src[i];
    if(!s)return;
    var w={port:port,cmd:s.command,name:s.name,at:Date.now(),until:Date.now()+(woken?SIG_WAIT_CEC_MS:SIG_WAIT_MS),polled:0,hard:fx.hard};sigWatch=w;
    (function step(){
      if(sigWatch!==w||inst.stopped)return;
      if(fx.hard!==w.hard){sigWatch=null;return;}
      var cur=null,all=denonSources(),st=window.__flexDenon.state()||{},data=st.data||{};
      for(var j=0;j<all.length;j++)if(all[j].port===port)cur=all[j];
      if(data.SI&&data.SI!==w.cmd){sigWatch=null;log('Denon: Bildpruefung '+w.name+' beendet (Eingang '+data.SI+')');return;}
      if(cur&&window.__flexDenon.sourceStatus(cur).indexOf('Signal ')===0){sigWatch=null;log('Denon: Bild von '+w.name+' nach '+Math.round((Date.now()-w.at)/1000)+' s');return;}
      if(Date.now()>=w.until){
        if(!(st.sourceAt>=w.until)&&Date.now()<w.until+SIG_LAST_MS){
          if(w.polled<w.until){try{if(window.__flexDenon.refresh())w.polled=Date.now();}catch(e){}}
          later(step,1000);return;
        }
        sigWatch=null;
        if(!(st.sourceAt>=w.until)){
          log('Denon: Bildstatus nach Zeitlimit nicht verfuegbar');
          return;
        }
        if(data.ZM==='ON'&&data.SI===w.cmd){
          log('Denon: kein Bild von '+w.name+', zurueck auf TV-Ton');
          denonToTv(null,function(x){return x.ZM==='ON'&&x.SI===w.cmd;});
          hint(w.name+': kein Bild – Denon zurück auf TV-Ton',6000);
        }
        return;
      }
      if(Date.now()-w.polled>=SIG_POLL_MS){try{if(window.__flexDenon.refresh())w.polled=Date.now();}catch(e){}}
      later(step,1000);
    })();
  }
  // ---- Kodi oder App von der Startseite, waehrend der Denon auf einem Geraet steht (Besitzer 17.11.2026) ----
  // Der Denon folgt dem TV nicht von selbst auf TV-Ton. Beim OK auf der Kodi- oder einer App-Kachel stellt flex.js ihn
  // darum auf TV, ohne Frage und ohne ZONE2 anzufassen; die App startet unveraendert sofort. Eine Konsole laeuft dabei
  // weiter: in den Ruhemodus laesst sich die PS5 vom TV aus nicht schicken (am TV gemessen: der "Standby" des TV-Menues,
  // HdmiDevicesOperate([1, Typ]), ist nur ein Tastendruck <User Control Pressed>, den sie ignoriert; den echten
  // <Standby> an ein Geraet bietet der Launcher nicht an). Sie geht mit dem TV in den Ruhemodus (Ausschaltverbindung
  // der PS5). Damit sie Kodi nicht per CEC verdraengt, ist an der PS5 die One-Touch-Wiedergabe aus. Eine fruehere
  // Fassung fragte vor dem Start ("In Ruhemodus versetzen") und wurde deshalb wieder entfernt.
  function denonAutoTv(app){
    try{
      var st=window.__flexDenon&&window.__flexDenon.state();
      if(!st||!st.data||st.data.ZM!=='ON')return false;
      var src=denonSources(),s=null;
      for(var i=0;i<src.length;i++)if(src[i].command===st.data.SI&&denonSourceListed(src[i]))s=src[i];
      if(!s)return false;
      var running=window.__flexDenon.sourceStatus(s).indexOf('Signal ')===0;
      stopSignalWatch();
      denonToTv();
      log('Denon: '+app+' gestartet, Denon von '+s.name+' auf TV-Ton');
      hint(running?s.name+' läuft im Hintergrund weiter · Denon auf TV-Ton':'Denon auf TV-Ton',4000);
      return true;
    }catch(e){log('Denon-TV-Fehler: '+e);return false;}
  }
  // Denon auf TV-Ton. Ist der Dienst belegt, reiht ui.js die Anfrage ein und holt sie nach (selectTv). want: siehe selectTv.
  function denonToTv(cb,want){
    var ok=false;
    try{ok=window.__flexDenon.selectTv(function(err){log(err?'Denon: TV-Ton nicht bestaetigt: '+err:'Denon: auf TV-Ton');if(cb)cb(err);},want);}catch(e){ok=false;}
    if(!ok){log('Denon: TV-Ton nicht moeglich');if(cb)cb('nicht moeglich');}
  }
  // ---- Neue Wahl des Nutzers bricht eine laufende Konsolenwahl ab (18.11.2026) ----
  // Am TV: Xbox gewaehlt, sofort danach Kodi gestartet; die Xbox-Wahl lief weiter, der Denon wechselte den Eingang,
  // meldete sich per CEC als aktive Quelle, der Launcher sprang auf HDMI1 und flex.js beendete Kodi. Jetzt: Kodi, eine App
  // (Kachel oder App-Taste), eine andere Konsole oder Zurueck verwerfen die laufende Wahl; ihre restlichen Denon-Schritte
  // entfallen, der gerade laufende endet noch.
  // Review 18.11.2026: Hatte die verworfene Wahl schon einen Schritt gesendet (auch Z2OFF/ZMON: ein eingeschaltetes MAIN
  // steht sonst auf seinem alten Geraete-Eingang) oder selbst eine solche Wahl abgeloest (prevDirty), bringt settleToTv den
  // Denon danach zurueck auf TV-Ton, entschieden auf dem Stand nach dem letzten Schritt (nur wenn MAIN an und nicht auf TV).
  // Folgt eine neue Konsole, erbt sie diese Pflicht und erfuellt sie, falls sie selbst nicht gesendet wird. Bis der Denon
  // bestaetigt zurueck ist (+2,5 s), warten Starts von Kodi und Apps (unsettled, hoechstens 45 s, Standby beendet es).
  var DEFER_SETTLE_MS=2500,DEFER_MAX_MS=25000,UNSETTLED_MAX_MS=45000,unsettled=null,pendingStart=null;
  function unsettledActive(){if(unsettled&&(unsettled.hard!==fx.hard||Date.now()>=unsettled.until))unsettled=null;return !!unsettled;}
  function settleToTv(why){
    var m={hard:fx.hard,until:Date.now()+UNSETTLED_MAX_MS};unsettled=m;
    log('Denon: zurueck auf TV-Ton nach verworfener Wahl ('+why+')');
    denonToTv(function(){later(function(){if(unsettled===m)unsettled=null;},DEFER_SETTLE_MS);},function(x){return x.ZM==='ON'&&x.SI!=='TV';});
  }
  function denonChoiceActive(){return !!sourceChoice;}
  function denonSupersede(why,noTv){
    var c=sourceChoice;if(!c)return {active:false,dirty:false};
    sourceChoice=null;c.superseded=true;
    var input=false;if(c.sent){try{input=!!window.__flexDenon.abortSequence();}catch(e){input=false;}}
    var dirty=!!(c.sent||c.prevDirty);
    if(inst.sourceSwitch&&inst.sourceSwitch.port===c.port)inst.sourceSwitch.phase='superseded';
    denonBusy('');stopSignalWatch();
    log('Denon: Wahl von HDMI '+c.port+' verworfen ('+why+')'+(input?', Eingangswechsel war schon unterwegs':dirty?', Denon-Schritte waren schon unterwegs':''));
    if(dirty&&!noTv)settleToTv('HDMI '+c.port);
    return {active:true,dirty:dirty};
  }
  // Tasten aus flex.js onKey (keydown; die Taste geht unveraendert weiter). Zurueck/Menue verwirft eine laufende Wahl nur,
  // solange sie dort wartet, wo sie gewaehlt wurde (Startseite, Quellen-Liste). Ist der TV schon auf HDMI1 gesprungen
  // (CEC des Denon), gehoert Zurueck dem Launcher und die Wahl laeuft zu Ende (Review 18.11.2026: vorher schickte Zurueck
  // zum Schliessen der Infoleiste den Denon von der eben gewaehlten PS5 zurueck auf TV). App-Tasten (Netflix 616,
  // Amazon 617, YouTube 619) starten eine App wie OK auf einer App-Kachel. Lautstaerke und Stumm aendern an einem
  // wartenden Start nichts (wie bei der Wahl selbst).
  var DENON_APP_KEYS={616:1,617:1,619:1};
  function denonKeyDown(k){
    if(pendingStart&&(k===411||k===412||k===413))pendingStart.keys=fx.keys;
    if(!sourceChoice)return;
    if(DENON_APP_KEYS[k]===1){denonSupersede('Taste '+k);return;}
    if(TM_BACK[k]!==1)return;
    var front=false;try{front=homeIdle()||UI.getCurrentSubModuleId()==='AllInputs';}catch(e){front=false;}
    if(front)denonSupersede('Taste '+k);
  }
  // Vor dem Start von Kodi oder einer App von der Startseite (flex.js handleTileKey). false = der Aufrufer startet sofort
  // wie bisher (der Denon geht parallel auf TV-Ton). true = Taste verbraucht: der Denon ist nach einer verworfenen Wahl
  // noch nicht zurueck auf TV-Ton. Dann wartet der Start darauf und laeuft danach nach erneuter Pruefung (Schutzregel 3:
  // keine Taste dazwischen, gleicher Launcher-Zustand launcherSig, Startseite frei, gleiche Kachel), sonst ein Hinweis.
  // Ein weiteres OK auf dieselbe Kachel waehrend des Wartens wird verbraucht und haelt den Start (Review 18.11.2026: vorher
  // startete das zweite OK sofort, und der CEC-Sprung beendete Kodi wieder); OK auf eine andere Kachel ersetzt ihn.
  function denonBeforeStart(app,start){
    var sup=denonSupersede('Start von '+app);
    if(pendingStart){
      var f='';try{f=String(mainTilesVm().componentFocus||'');}catch(e){f='';}
      if(f===pendingStart.focus&&fx.hard===pendingStart.hard){pendingStart.keys=fx.keys;log('Denon: '+app+' wartet schon auf TV-Ton');return true;}
      pendingStart.done=true;pendingStart=null;
    }
    if(sup.dirty||unsettledActive()){deferStart(app,start);return true;}
    denonAutoTv(app);
    return false;
  }
  function deferStart(app,start){
    var p={app:app,keys:fx.keys,hard:fx.hard,focus:'',sig:'',at:Date.now(),done:false};pendingStart=p;
    try{p.focus=String(mainTilesVm().componentFocus||'');}catch(e){p.focus='';}
    try{p.sig=launcherSig();}catch(e){p.sig='';}
    denonBusy(app+' startet gleich …');
    log('Denon: Start von '+app+' wartet auf TV-Ton');
    function go(why){
      p.done=true;if(pendingStart===p)pendingStart=null;denonBusy('');
      var v=null,home=false,ok=false;
      try{
        home=homeIdle();v=mainTilesVm();
        ok=why==='Denon auf TV'&&!inst.stopped&&fx.keys===p.keys&&fx.hard===p.hard&&home&&uiReadyNow()&&!dialogUp()&&
          !!p.sig&&launcherSig()===p.sig&&!!v&&String(v.componentFocus||'')===p.focus;
      }catch(e){ok=false;}
      if(!ok){
        log('Denon: Start von '+app+' verworfen ('+why+')');
        if(!inst.stopped)hint(home?app+': Start abgebrochen – bitte noch einmal wählen':app+' nicht gestartet – über HOME neu wählen',4000);
        return;
      }
      log('Denon: Start von '+app+' (Denon auf TV)');start();
    }
    (function wait(){
      if(p.done)return;
      if(inst.stopped||fx.hard!==p.hard){p.done=true;if(pendingStart===p)pendingStart=null;return;}
      if(!unsettledActive()){go('Denon auf TV');return;}
      if(Date.now()-p.at>=DEFER_MAX_MS){go('Zeitlimit, Denon nicht zurueck');return;}
      later(wait,250);
    })();
  }
  // Kleine Anzeige beim Wechsel auf ein Denon-Geraet (Besitzer 17.11.2026: kleines Popup, kein Vollbild): ab dem OK bis
  // der TV umgeschaltet hat oder die Wahl endet. Nutzt den Hinweis von flex.js (kodiToast); ohne ihn (Tests) nichts.
  function denonBusy(text){try{kodiToast(text||'',text?20000:0);}catch(e){}}
  // TV auf HDMI1 wie die Quellen-Liste des Launchers (AllInputs.vue keydown, OK auf einem Eingang, 126.js):
  // SourceSwitchByUser(a, 17) ist UI.store.commit('Source/setCurrentSource', [a, 17]) (app.js PubFunc tt), dann
  // popAllModule() und openLiveTVModule(): warten, bis die Quelle steht (dort hoechstens ~1 s), dann
  // LiveTV/setShowFlgArr ['showPassword', true, 'showInfobar', true] und pushModule('LiveTV'). Gleiche Aufrufe und Werte,
  // nur ohne den sichtbaren Quellen-Bildschirm (Besitzer 17.11.2026: kein Springen in die Quellen, kein Flackern).
  // Steht der Store schon auf HDMI1, entfaellt der Quellenbefehl wie in der Liste (a === getCurrentSource()).
  function tvToHdmi1(){
    var cur='';try{cur=UI.store.state.Source.currSourceId;}catch(e){cur='';}
    if(cur!=='HDMI1')UI.store.commit('Source/setCurrentSource',['HDMI1',17]);
    UI.popAllModule();
    var n=0;
    (function wait(){
      var now='';try{now=UI.store.state.Source.currSourceId;}catch(e){now='';}
      if(now!=='HDMI1'&&++n<20){later(wait,50);return;}
      try{UI.store.commit('LiveTV/setShowFlgArr',['showPassword',true,'showInfobar',true]);}catch(e){}
      UI.pushModule('LiveTV');
      log('Denon: TV auf HDMI1 (wie die Quellen-Liste'+(cur==='HDMI1'?', Quelle stand schon':'')+(now!=='HDMI1'?', Quelle nach 1 s noch nicht bestaetigt':'')+')');
    })();
  }
  var sourceChoice = null;
  window.__flex.denonSwitchState=function(){return inst.sourceSwitch||null;};
  // Wahl eines Denon-Geraets. Von der Startseite bzw. der Konsolen-Reihe: direkt (Denon umschalten, dann tvToHdmi1), ohne
  // Quellen-Bildschirm. Aus der Quellen-Liste selbst (Eintrag dort gewaehlt) oder wenn eine App im Modul-Stapel liegt
  // (Schutzregel 2: dann entscheidet der Launcher ueber seine Liste): wie bisher ueber die Liste und ihren eigenen OK-Pfad.
  function chooseDenonSource(port){
    if(!window.__flexDenon)return;
    // Dieselbe Konsole noch einmal (z. B. ueber die Konsolen-Reihe, waehrend der Dienst noch belegt ist): bestaetigt die
    // laufende Wahl, die Tasten dazwischen brechen sie nicht ab (Review 18.11.2026). Eine andere Konsole loest sie ab und
    // erbt deren unterwegs befindliche Denon-Schritte (prevDirty, siehe denonSupersede).
    var prevDirty=false;
    if(sourceChoice){
      if(sourceChoice.port===port){sourceChoice.keys=fx.keys;log('Denon: HDMI '+port+' ist schon gewaehlt');return;}
      prevDirty=denonSupersede('neue Wahl: HDMI '+port,true).dirty;
    }
    if(pendingStart){pendingStart.done=true;pendingStart=null;}   // ein wartender Kodi-/App-Start ist damit hinfaellig
    stopSignalWatch();
    var inList=UI.getCurrentSubModuleId()==='AllInputs',direct=false;
    try{direct=!inList&&noAppInStack();}catch(e){direct=false;}
    var choice={port:port,keys:0,until:Date.now()+90000,opening:!inList,routeUntil:Date.now()+5000,prevDirty:prevDirty};sourceChoice=choice;
    inst.sourceSwitch={port:port,phase:'waiting',direct:direct};
    // CEC-Start sofort auf die Taste, parallel zum Denon-Wechsel (die Konsole braucht die Zeit zum Hochfahren)
    inst.sourceSwitch.cecEarly=cecStartDevice(port);
    var busyName='';try{var bs=denonSources();for(var bi=0;bi<bs.length;bi++)if(bs[bi].port===port)busyName=bs[bi].name;}catch(e){busyName='';}
    denonBusy(inst.sourceSwitch.cecEarly==='gesendet'?busyName+' wird gestartet …':'Umschalten auf '+(busyName||'HDMI '+port)+' …');
    if(!inList&&!direct)openSources();
    // Wahl endet, ohne selbst gesendet zu haben: erbt sie Schritte einer verworfenen Wahl, Denon zurueck auf TV-Ton
    function drop(phase){
      if(sourceChoice===choice)sourceChoice=null;
      if(phase)inst.sourceSwitch.phase=phase;
      choice.sent=false;denonBusy('');
      if(choice.prevDirty)settleToTv('HDMI '+port+' nicht gesendet');
    }
    function onHdmi1(){try{return UI.getCurrentSubModuleId()==='LiveTV'&&UI.store.state.Source.currSourceId==='HDMI1';}catch(e){return false;}}
    function timeout(){later(function(){if(sourceChoice===choice&&!choice.superseded){sourceChoice=null;inst.sourceSwitch.phase='timeout-or-error';denonBusy('');UI.showToast(window.__flexDenon.state().notice);}},80000);}
    function receiverDone(error){
      sourceChoice=null;denonBusy('');
      if(error){inst.sourceSwitch.phase='failed';inst.sourceSwitch.error=error;log('Denon: Quellenwechsel fehlgeschlagen: '+error);UI.showToast(error);if(choice.prevDirty)settleToTv('HDMI '+port+' fehlgeschlagen');return false;}
      inst.sourceSwitch.phase='receiver-confirmed';
      startSignalWatch(port,inst.sourceSwitch.cecEarly==='gesendet');
      if(onHdmi1()){
        inst.sourceSwitch.phase='complete-hdmi1-already-active';log('Denon: bestaetigt, TV bereits auf HDMI1');
        if(!inst.stopped&&fx.keys===choice.keys&&!dialogUp())afterDenonSwitch(port);
        return false;
      }
      return true;
    }
    function attemptDirect(){
      if(sourceChoice!==choice||inst.stopped)return;
      if(Date.now()>choice.until||fx.keys!==choice.keys||dialogUp()){drop('cancelled-before-send');return;}
      var bs0=window.__flexDenon.state();if(bs0.pending||bs0.busy){later(attemptDirect,400);return;}
      inst.sourceSwitch.phase='receiver';
      choice.sent=true;
      if(!window.__flexDenon.selectSource(port,function(error){
        if(choice.superseded)return;
        if(!receiverDone(error))return;
        var free=false;try{free=homeIdle()&&uiReadyNow()&&noAppInStack();}catch(e){free=false;}
        if(inst.stopped||fx.keys!==choice.keys||dialogUp()||!free){inst.sourceSwitch.phase='cancelled-after-receiver';log('Denon: HDMI-Wechsel abgebrochen nach Navigation/Dialog');return;}
        inst.sourceSwitch.phase='tv-hdmi1';log('Denon: bestaetigt, HDMI1 direkt');tvToHdmi1();afterDenonSwitch(port);
      })){drop('');return;}
      timeout();
    }
    function attempt(){
      if(sourceChoice!==choice||inst.stopped)return;
      if(Date.now()>choice.until||fx.keys!==choice.keys||dialogUp()){drop('cancelled-before-send');return;}
      if(UI.getCurrentSubModuleId()!=='AllInputs'){
        if(choice.opening&&Date.now()<choice.routeUntil){later(attempt,100);return;}
        // CEC-Sprung der abgeloesten Wahl (der Denon wechselte noch auf deren Eingang): der TV steht schon auf HDMI1, also
        // ohne Liste weiter wie die direkte Wahl; deren Rueckruf endet mit 'complete-hdmi1-already-active'
        if(choice.prevDirty&&onHdmi1()){choice.opening=false;log('Denon: Liste durch CEC-Sprung geschlossen, HDMI '+port+' direkt');attemptDirect();return;}
        drop('cancelled-route');return;
      }
      choice.opening=false;
      var v=inputVm();
      var bs1=window.__flexDenon.state();if(!v||bs1.pending||bs1.busy){later(attempt,400);return;}
      patchDenonInputs();var original=v.__flexSourcesOrig;if(typeof original!=='function'){drop('');return;}
      inst.sourceSwitch.phase='receiver';
      choice.sent=true;
      if(!window.__flexDenon.selectSource(port,function(error){
        if(choice.superseded)return;
        if(!receiverDone(error))return;
        if(inst.stopped||fx.keys!==choice.keys||UI.getCurrentSubModuleId()!=='AllInputs'||dialogUp()||v._isDestroyed){inst.sourceSwitch.phase='cancelled-after-receiver';log('Denon: HDMI-Wechsel abgebrochen nach Navigation/Dialog');return;}
        for(var i=0;i<v.allInputsData.length;i++)if(v.allInputsData[i].sourceId==='HDMI1'){
          inst.sourceSwitch.phase='tv-hdmi1';v.currentFocus='AllInputsGridViewItem-'+i;original.call(v,{keyCode:13,repeat:false});log('Denon: bestaetigt, nativer HDMI1-Wechsel angefordert');afterDenonSwitch(port);return;
        }
      })){drop('');return;}
      timeout();
    }
    later(function(){choice.keys=fx.keys;(direct?attemptDirect:attempt)();},0);
  }
  function denonInputKey(vm,orig,args){
    var e=args[0],it=focusedDenonInput(vm);
    if(it&&e&&(e.keyCode===13||e.keyCode===77||e.keyCode===567||e.keyCode===(window.CONST&&CONST.KEY.VK_MENU))){
      if(!inst.stopped&&e.keyCode===13&&!e.repeat)chooseDenonSource(it.denonPort);
      else if(!inst.stopped&&e.keyCode!==13)UI.showToast('Namen unter Alle Apps > Denon > Quellennamen aendern');
      return true;
    }
    return orig.apply(vm,args);
  }
  function patchDenonInputs(){
    if(UI.getCurrentSubModuleId()!=='AllInputs')return;
    var v=inputVm();if(!v)return;
    if(v.$el&&v.$el.children&&v.$el.children[0])v.$el.children[0].id='flex-input-cover';
    var methods=v.constructor&&v.constructor.options&&v.constructor.options.methods;
    if(methods&&methods.keydown&&methods.keydown.__flexSourcesOwner!==inst){
      var original=methods.keydown;while(original.__flexSourcesOrig)original=original.__flexSourcesOrig;
      var wrapped=function(){return denonInputKey(this,original,arguments);};
      wrapped.__flexSources=true;wrapped.__flexSourcesOwner=inst;wrapped.__flexSourcesOrig=original;methods.keydown=wrapped;denonInputMethods=methods;
    }
    if(v.__flexSourcesOwner!==inst){var ownOriginal=methods&&methods.keydown?methods.keydown:v.keydown;while(ownOriginal.__flexSourcesOrig)ownOriginal=ownOriginal.__flexSourcesOrig;v.__flexSourcesOrig=ownOriginal;v.__flexSourcesOwner=inst;v.keydown=function(){return denonInputKey(v,ownOriginal,arguments);};}
    denonInputRef=v;
    var data=v.allInputsData,base=null,src=denonSources();
    if(!data||!src.length)return;
    var focusedIndex=parseInt(String(v.currentFocus).split('-')[1],10),focusedId=data[focusedIndex]&&data[focusedIndex].sourceId,changed=false;
    for(var di=data.length-1;di>=0;di--)if(data[di].denonPort){
      var keep=sourceChoice&&sourceChoice.port===data[di].denonPort;
      for(var si=0;si<src.length;si++)if(src[si].port===data[di].denonPort&&denonSourceListed(src[si]))keep=true;
      if(!keep){data.splice(di,1);changed=true;}
    }
    for(var i=0;i<data.length;i++)if(data[i].sourceId==='HDMI1')base=data[i];
    if(!base)return;
    for(i=0;i<src.length;i++){
      var s=src[i],id='flex-denon-source-'+s.port,found=null;
      if(!denonSourceListed(s)&&!(sourceChoice&&sourceChoice.port===s.port))continue;
      for(var j=0;j<data.length;j++)if(data[j].sourceId===id)found=data[j];
      var state=window.__flexDenon.sourceStatus(s),title=s.name;
      if(!found){found=JSON.parse(JSON.stringify(base));found.sourceId=id;found.denonPort=s.port;found.icon='static/flex/tile-denon.png';found.Locked=false;found.locked=false;found.name=title;found.rename=title;found.deviceName=state;found.hasSignal=false;found.linked=false;data.push(found);}
      found.name=found.rename=title;found.deviceName='';
      found.hasSignal=state.indexOf('Signal ')===0;
      found.linked=window.__flexDenon.state().data.SI===s.command&&window.__flexDenon.state().data.ZM==='ON';
    }
    if(changed&&!v.showMenu){var next=Math.max(0,Math.min(focusedIndex,data.length-1));for(i=0;i<data.length;i++)if(data[i].sourceId===focusedId)next=i;v.currentFocus='AllInputsGridViewItem-'+next;}
  }
  function sourceCarousel(){
    var v=mainTilesVm(),st=window.UI&&launcherState(UI.store);if(!v||!st)return;
    var n=parseInt(String(v.componentFocus).split('-')[1],10);
    if(isNaN(n))n=st.mainTileListIndex||0;
    if(n<sourceOffset)sourceOffset=n;
    if(n>sourceOffset+8)sourceOffset=n-8;
    sourceOffset=Math.max(0,Math.min(sourceOffset,Math.max(0,st.mainTileData.length-9)));
    var key=st.mainTileData.length+':'+sourceOffset;
    if(key!==sourceLayout){
      sourceLayout=key;var css='';
      for(var i=0;i<st.mainTileData.length;i++)css+='#LauncherMainTile-'+i+'{left:'+(2.4+(i-sourceOffset)*6.667)+'rem !important;top:1.43rem !important;visibility:'+(i>=sourceOffset&&i<sourceOffset+9?'visible':'hidden')+' !important;transition:left 0.25s ease !important;}';
      var old=document.getElementById('flex-source-slide');if(old)old.parentNode.removeChild(old);
      var style=document.createElement('style');style.id='flex-source-slide';style.textContent=css;document.head.appendChild(style);
    }
    for(var k=0;k<st.mainTileData.length;k++){
      var tile=st.mainTileData[k];
      var el=document.getElementById('LauncherMainTile-'+k);if(!el)continue;
      var label=el.querySelector('.flex-source-label');
      var face=el.querySelector('.main');
      if(!tile.denonPort&&!tile.denonGroup){if(label)label.parentNode.removeChild(label);if(face)face.className=face.className.replace(/\s*flex-denon-face/g,'');continue;}
      if(!face)continue;
      if(face.className.indexOf('flex-denon-face')<0)face.className+=' flex-denon-face';
      if(!label){label=document.createElement('div');label.className='flex-source-label';}
      if(label.parentNode!==face)face.appendChild(label);
      label.textContent=tile.appName;
    }
  }
  function stopDenonSources(){
    if(denonInputRef&&denonInputRef.__flexSourcesOrig){denonInputRef.keydown=denonInputRef.__flexSourcesOrig.bind(denonInputRef);delete denonInputRef.__flexSourcesOrig;delete denonInputRef.__flexSourcesOwner;}
    if(denonInputMethods&&denonInputMethods.keydown.__flexSources)denonInputMethods.keydown=denonInputMethods.keydown.__flexSourcesOrig;
    var s=document.getElementById('flex-source-slide');if(s)s.parentNode.removeChild(s);
    closeDenonGroup('Stopp');
    denonBusy('');
    stopSignalWatch();
    if(pendingStart){pendingStart.done=true;pendingStart=null;}
    unsettled=null;
  }

/* END FLEX DENON SOURCES */

  // Hat die Kodi-Kachel den Fokus? (onKey, nur lesen)
  function kodiTileFocused() {
    try {
      var vm = mainTilesVm(), st = launcherState(window.UI.store), f = String((vm && vm.componentFocus) || '');
      if (f.indexOf('LauncherMainTile') !== 0 || !st || !st.mainTileData) return false;
      var t = st.mainTileData[parseInt(f.split('-')[1], 10)];
      return !!t && t.appId === KODI_TILE.appId;
    } catch (e) {
      return false;
    }
  }

  // ---- Kachel-Menü über die Einstellungstaste (Wunsch 2 des Besitzers, 2026-10-29) ----
  // Einstellungstaste (CONST.KEY.VK_SETTINGS = 567) auf einer App-Kachel der Startseite öffnet ein
  // kleines Menü "App schließen" / "Abbrechen" (Hoch/Runter wählt, OK führt aus, Zurück schließt).
  // Ohne Mod öffnet 567 dort die TV-Einstellungen (MainTiles.keydown kennt 567 nicht, 92.js
  // L1325-1435; die Taste steigt bis zum KeyEventDispatcher, VK_SETTINGS -> openSettings, app.js
  // L1251-1262). Das Menü öffnet nur, wenn "App schließen" wirklich etwas tun kann (App pausiert im
  // Hintergrund, Freigabe gerade möglich); sonst geht schon der erste Druck unverändert an den
  // Launcher (TV-Einstellungen wie ohne Mod), bei einer App unter der Startseite bzw. einer schon
  // freigegebenen oder gerade gesperrten nur mit einem kurzen Hinweis. Bei offenem Menü schließt ein
  // zweiter Druck es und geht unverändert an den Launcher (kein Nachbau von openSettings). Auf Kodi,
  // Quellen und Alle Apps bleibt 567 ganz beim Launcher.
  // "App schließen" beendet die App nicht nachweislich (siehe "Hintergrund-Apps freigeben" unten):
  // es gibt den TV-Player für Kodi frei, die App bleibt nach allem, was der Launcher weiß, pausiert.
  // Die Hinweise sagen darum "TV-Player frei", nie "geschlossen".
  // Tasten nur über die Hülle um MainTiles.keydown (handleTileKey), nicht über onKey: gibt die Hülle
  // true zurück, gibt UI.js die Taste nicht weiter und quittiert sie selbst genau einmal (ve() ->
  // Ce() -> guiService.sendResult(true, 1|2|8, keyCode), app.js L9745-9761), also genau die
  // Quittung, die swallow() schickt. Darum hier weder swallow() noch ackKey() (sonst doppelt). Das
  // keyup läuft wie immer durch den Launcher (MainTiles hat kein keyup, der Dispatcher quittiert es).
  // Die App der Kachel bestimmt flex.js wie der Launcher beim Start: Name aus der Kachel-URL
  // (oe(), OA:8343-8360: netflix/youtube/amazon, sonst 'browser' mit dem App-Namen klein ohne
  // Leerzeichen, OA:8506). Ihr Zustand (nur lesen):
  // - pausiert im Hintergrund (YouTube runningOnBack, Netflix runningOnBackForNetflix bzw.
  //   openFromNetflix) und kein AppControl im Stapel: Menü; "App schließen" = bgCloseStart wie beim
  //   Kodi-Start, danach LAST über scheduleDmpExit (prüft beim Feuern neu);
  // - pausiert, aber eine andere App liegt unter der Startseite (AppControl im Stapel): gerade nicht
  //   (bgCloseBlock), nur Hinweis;
  // - unter der Startseite (HOME in der App, AppControl im Stapel): beenden kann sie nur EXIT auf
  //   der Startseite (92.js L1939-1941: popAllModule über AppControl, AppControl-Mutation, LAST,
  //   Live-TV). Das verbieten Schutzregeln 4 und 7: nur Hinweis "Exit beendet sie" (die Ausnahme
  //   des Besitzers vom 08.11.2026 gilt nur für OK auf der Kodi-Kachel, siehe uhStart);
  // - sonst weiß der Launcher nichts über die App (Prime und Browser-Apps haben keinen
  //   Hintergrund-Merker): kein Menü, kein Hinweis.
  // Das Menü gilt nur, solange die Startseite vorne und frei ist und die Kachel den Fokus hat
  // (Schutzregeln 5 und 6); jede Taste und der 1-s-Takt prüfen das (checkTileMenu). Es verbraucht
  // nur die Tasten, die es selbst benutzt (Zurück/Menü, Pfeile, OK); jede andere Taste (App-,
  // System-, Ziffern-, Farbtasten, VK_DISMATCH_CODE1-4 ...) schließt es und geht unverändert weiter.
  var TM_BACK = { 8: 1, 409: 1, 461: 1 };   // Zurück, Menü, Zurück: nur das Menü schließen
  var TM_NAMES = { netflix: 1, youtube: 1, amazon: 1 };
  var TM_W = 520, TM_ROW_Y = 92, TM_ROW_DY = 76;
  var tm = { open: false, el: null, rows: [], can: [], idx: 0, focus: '', app: null, st: '', hard: 0 };

  function isTileMenuKey(k) {
    var K = window.CONST && window.CONST.KEY;
    return k === ((K && K.VK_SETTINGS) || 567);
  }

  // App einer Kachel; null für unsere eigenen Kacheln
  function tileApp(tile) {
    var id = String(tile.appId);
    if (tile.denonPort) return null;
    if (id === KODI_TILE.appId || id === SOURCES_TILE.appId || id === MYAPPS_TILE.appId || id === GALLERY_TILE.appId || id === DENON_TILE.appId) return null;
    var u = String(tile.url || '').toLowerCase(), label = String(tile.appName || '');
    if (!u || !label) return null;
    return { label: label, name: TM_NAMES[u] === 1 ? u : 'browser', local: label.toLowerCase().replace(' ', '') };
  }

  // Hintergrund-Merker nur dieser App (YouTube bzw. Netflix; andere Apps haben keine)
  function tileMarks(app) {
    var m = bgMarks();
    if (!m) return null;
    if (app.name === 'youtube') return { rob: m.rob, robn: false, ofn: false };
    if (app.name === 'netflix') return { rob: false, robn: m.robn, ofn: m.ofn };
    return { rob: false, robn: false, ofn: false };
  }

  // 'front' unter der Startseite, 'paused' im Hintergrund pausiert (auch, wenn gerade eine andere
  // App unter der Startseite liegt: bgCloseBlock sagt dann "App im Modul-Stapel"), 'released' vom
  // Nutzer für den TV-Player freigegeben (bgCovered), '' läuft nicht (soweit der Launcher es weiß),
  // null nicht lesbar
  function tileAppState(app) {
    try {
      var UI = window.UI, ac = UI.store.state.AppControl;
      if (!ac) return null;
      var m = tileMarks(app);
      if (UI.isSubModuleExist('AppControl', 'AppControl')) {
        if (ac.currentAppName === app.name && (app.name !== 'browser' || ac.currentLocalAppName === app.local)) return 'front';
        return m && bgAny(m) ? 'paused' : '';
      }
      if (!m) return null;
      if (!bgAny(m)) return '';
      return bgCovered(m) ? 'released' : 'paused';
    } catch (e) {
      return null;
    }
  }

  // Einstellungstaste auf einer App-Kachel (aus handleTileKey): true = Menü offen (Taste
  // verbraucht), false = Taste geht unverändert an den Launcher (TV-Einstellungen), ggf. mit Hinweis
  function openTileMenu(tile, idx, focus) {
    var app = tileApp(tile);
    if (!app || tm.open) return false;
    if (!homeIdle() || !uiReadyNow() || dialogUp() || ss.state !== 'off' || gal.open || bgc ||
      kodiPending() || kodi.active || kodiActive()) return false;
    var st = tileAppState(app);
    var block = st === 'paused' ? bgCloseBlock() : '';
    if (st !== 'paused' || block) {
      // nichts zu tun: kein Menü (die Taste nicht verschlucken), höchstens ein kurzer Hinweis
      var hint = st === 'front' ? app.label + ' läuft noch: Exit beendet die App' :
        st === 'released' ? app.label + ' pausiert, TV-Player schon frei' :
        st === 'paused' ? app.label + ' lässt sich gerade nicht schließen' +
          (block === 'App im Modul-Stapel' ? ' (erst die offene App mit Exit beenden)' : '') : '';
      if (hint) kodiToast(hint, 3000);
      log('Kachel-Menü nicht geöffnet: ' + app.label + ' (' + (st === null ? 'unlesbar' : st || 'läuft nicht') +
        (block ? ', ' + block : '') + ')');
      return false;
    }
    var note = 'pausiert';
    tm.app = app;
    tm.st = st;
    tm.focus = focus;
    tm.hard = fx.hard;
    tm.can = [true, true];
    tm.idx = 0;
    // Aufbau nur mit createElement/textContent (App-Namen kommen aus den Launcher-Daten)
    var el = document.createElement('div');
    el.id = 'flex-tile-menu';
    // über der Kachel: Kachel n steht bei 2.4rem + n * 6.667rem, 5.867rem breit (flex.css, 1rem = 30px)
    el.style.left = Math.max(40, Math.min(1920 - 40 - TM_W, 160 + 200 * idx - TM_W / 2)) + 'px';
    var title = document.createElement('div');
    title.className = 'ftm-title';
    title.textContent = app.label;
    el.appendChild(title);
    var labels = ['App schließen', 'Abbrechen'];
    tm.rows = [];
    for (var i = 0; i < labels.length; i++) {
      var r = document.createElement('div');
      r.style.top = (TM_ROW_Y + i * TM_ROW_DY) + 'px';
      var t = document.createElement('div');
      t.className = 'ftm-label';
      t.textContent = labels[i];
      r.appendChild(t);
      var n = document.createElement('div');
      n.className = 'ftm-note';
      n.textContent = i === 0 ? note : '';
      r.appendChild(n);
      el.appendChild(r);
      tm.rows.push(r);
    }
    var hints = ['OK: wählen · Zurück: schließen', 'Einstellungstaste: TV-Einstellungen'];
    for (var j = 0; j < hints.length; j++) {
      var h = document.createElement('div');
      h.className = 'ftm-hint';
      h.style.top = (TM_ROW_Y + labels.length * TM_ROW_DY + 6 + j * 28) + 'px';
      h.textContent = hints[j];
      el.appendChild(h);
    }
    (document.body || document.documentElement).appendChild(el);
    tm.el = el;
    tm.open = true;
    renderTileMenu();
    log('Kachel-Menü offen: ' + app.label + ' (' + st + ')');
    return true;
  }

  function renderTileMenu() {
    for (var i = 0; i < tm.rows.length; i++) {
      var cls = 'ftm-item' + (tm.can[i] ? '' : ' off') + (i === tm.idx ? ' focus' : '');
      if (tm.rows[i].className !== cls) tm.rows[i].className = cls;
    }
  }

  function closeTileMenu(why) {
    if (!tm.open) return;
    tm.open = false;
    if (tm.el && tm.el.parentNode) tm.el.parentNode.removeChild(tm.el);
    tm.el = null;
    tm.rows = [];
    tm.app = null;
    log('Kachel-Menü geschlossen (' + why + ')');
  }

  // Menü gilt nur, solange die Startseite vorne und frei ist und dieselbe Kachel den Fokus hat
  function tileMenuValid(vm) {
    return tm.hard === fx.hard && homeIdle() && uiReadyNow() && !dialogUp() && ss.state === 'off' && !gal.open &&
      !!vm && String(vm.componentFocus || '') === tm.focus;
  }

  function checkTileMenu() {   // 1-s-Takt (Schutzregel 6)
    if (tm.open && !tileMenuValid(mainTilesVm())) closeTileMenu('Startseite nicht mehr frei');
  }

  // Taste bei offenem Menü (aus handleTileKey): true = verbraucht (UI.js quittiert), undefined =
  // Original (Menü ist dann schon zu)
  function tileMenuKey(vm, e) {
    var k = e.keyCode;
    if (!tileMenuValid(vm)) {
      closeTileMenu('Startseite nicht mehr frei');
      return undefined;
    }
    if (isTileMenuKey(k)) {
      if (e.repeat) return true;
      closeTileMenu('Einstellungstaste');
      return undefined;                     // Launcher öffnet die TV-Einstellungen wie ohne Mod
    }
    if (SS_PASS_KEYS[k] === 1) return undefined;          // Power, Lautstärke, Stumm wie immer, Menü bleibt
    if (TM_BACK[k] === 1) {
      if (!e.repeat) closeTileMenu('Taste ' + k);
      return true;
    }
    if (k === 38 || k === 40) {
      tileMenuMove(k === 38 ? -1 : 1);
      return true;
    }
    if (k === 37 || k === 39) return true;                // Fokus bleibt auf der Kachel des Menüs
    if (k === 13) {
      if (!e.repeat) tileMenuSelect();
      return true;
    }
    // jede andere Taste (Home, Exit, Quelle, App-Tasten wie Rakuten 620, DAZN 689, Live-TV 556,
    // VK_DISMATCH_CODE1-4, Ziffern ...): Menü zu, Taste unverändert an MainTiles/Launcher wie ohne Mod
    closeTileMenu('Taste ' + k);
    return undefined;
  }

  function tileMenuMove(d) {
    for (var i = tm.idx + d; i >= 0 && i < tm.rows.length; i += d) {
      if (tm.can[i]) { tm.idx = i; break; }
    }
    renderTileMenu();
  }

  function tileMenuSelect() {
    var app = tm.app, i = tm.idx;
    closeTileMenu(i === 0 ? 'App schließen' : 'Abbrechen');
    if (i !== 0 || !app) return;
    // erst jetzt, direkt auf das OK hin, neu prüfen (seit dem Öffnen kann sich alles geändert haben)
    var st = tileAppState(app), block = bgCloseBlock(), m = tileMarks(app);
    if (st !== 'paused' || block || !m) {
      log('Kachel-Menü: ' + app.label + ' nicht freigegeben (' + (block || st || 'läuft nicht') + ')');
      kodiToast(app.label + ' lässt sich gerade nicht schließen', 3000);
      return;
    }
    kodiToast(app.label + ': TV-Player wird freigegeben …', BG_CLOSE_MAX_MS + BG_SETTLE_MS + 1000);
    bgCloseStart(m, false, function (res, why, c) {
      if (res === 'done') {
        kodiToast(app.label + ' pausiert, TV-Player frei', 3000);
        scheduleDmpExit('App freigegeben', 'close');   // zurück zur letzten Quelle, beim Feuern geprüft
        return;
      }
      kodiToast(res === 'timeout' ? app.label + ': TV-Player nicht freigegeben' : 'App schließen abgebrochen', 4000);
      // unser DMP-Befehl ist raus: wieder verlassen, sobald es steht (scheduleDmpExit wartet und
      // prüft beim Feuern neu); nach App-Start, Dialog oder STR gehören Quelle und Player anderen
      if (bgExitAfter(res, why, c)) scheduleDmpExit('App schließen ' + (res === 'timeout' ? 'ohne Ergebnis' : 'abgebrochen'), 'close');
      else log('DMP bleibt (Kachel-Menü: ' + (res === 'timeout' ? 'ohne Ergebnis' : 'abgebrochen, ' + why) + ')');
    });
  }

  // Nur lesen, für Tests und flexdbg: Freigabe, laufendes Schließen, Kachel-Menü
  window.__flex.bgState = function () {
    return JSON.parse(JSON.stringify({ rel: bgRel,
      closing: bgc ? { kodi: bgc.kodi, names: bgc.names, dmpAt: bgc.dmpAt, app: !!bgc.app } : null,
      menu: tm.open ? { app: tm.app && tm.app.label, st: tm.st, idx: tm.idx, can: tm.can } : null }));
  };

  // ---- Kodi ----
  // Startanforderung an den Wächter (kodi-watch.sh, root): Datei flexkodi/start mit der Uhrzeit in
  // Sekunden; der Wächter nimmt nur frische Anforderungen (höchstens 5 s alt). Nur von der
  // eigenen, sichtbaren Startseite aus, ohne App im Modul-Stapel und ohne Dialog, höchstens alle
  // 10 s. Kodi deckt dann den Bildschirm ab und nimmt die Fernbedienung exklusiv; Power beendet
  // es (5 s halten: sofort). Kodi gilt für alle Quellen-/Player-Entscheidungen als App (appFree).
  // Bis Kodi läuft (angefordert, noch kein Lebenszeichen) bzw. solange es läuft, wacht ssTick():
  // kommt eine App oder ein anderes Modul nach vorne (Cast, DIAL, Sprache, CEC) oder ein
  // Systemdialog (z. B. Auto-Standby), wird Kodi über flexkodi/stop beendet, damit App bzw. Dialog
  // die Fernbedienung bekommen. Nur Dateien schreiben, nie den App-Startpfad anfassen.
  // Solange Kodi läuft, kann es Filme über den Medienplayer des TVs abspielen lassen (kodiPlay,
  // nach dem Bildschirmschoner); nur dieses Modul fasst dann Quelle und Player an (appFreeCore).
  var KODI_START_MS = 25000;  // so lange auf das erste Lebenszeichen warten
  var kodi = { askedAt: 0, sig: '', active: false };
  var kodiBusy = false;  // Ergebnis von kodiTick() im 1-s-Takt

  // Modul-Stapel vorne: ändert sich, wenn eine App oder ein anderes Modul nach vorne kommt. Ohne
  // AppControl-Zustand/App-Namen (die ändert der Launcher auch für Hintergrund-Apps).
  function frontSig() {
    try {
      var UI = window.UI, s = [UI.getCurrentModuleId(), UI.getCurrentSubModuleId(),
        UI.isSubModuleExist('AppControl', 'AppControl')];
      for (var i = 0; i < APP_MODULES.length; i++) s.push(UI.isModuleExist(APP_MODULES[i]));
      return s.join('|');
    } catch (e) {
      return '';
    }
  }

  // Keine App im Modul-Stapel und keine im Start/Ende (wie appFree, aber ohne die Hintergrund-
  // Flags runningOnBack/openFromNetflix, die nach jeder YouTube/Netflix-Nutzung stehen bleiben)
  function noAppInStack() {
    try {
      var UI = window.UI, ac = UI.store.state.AppControl;
      if (UI.isSubModuleExist('AppControl', 'AppControl')) return false;
      for (var i = 0; i < APP_MODULES.length; i++) if (UI.isModuleExist(APP_MODULES[i])) return false;
      return !!ac && ac.currentAMState !== 'starting' && ac.currentAMState !== 'stopping';
    } catch (e) {
      return false;
    }
  }

  function kodiFile(name, text) {
    try {
      // hisense.file.write meldet Fehler über einen Rückgabewert ungleich 0 (z. B. Ordner fehlt,
      // weil der Wächter nicht läuft)
      var r = window.hisense.file.write('flexkodi/' + name, text, 1);
      if (typeof r === 'number' && r !== 0) { log('Kodi: ' + name + ' nicht schreibbar, Code ' + r); return false; }
      return true;
    } catch (e) {
      log('Kodi: ' + name + ' nicht schreibbar: ' + e);
      return false;
    }
  }

  // Nur über die eigene Kachel (handleTileKey). Wunsch 1 des Besitzers (2026-10-29): "sobald Kodi
  // gestartet wird, alle Apps automatisch schließen". Für nur im Hintergrund pausierte Apps (bgMarks)
  // wird zuerst der TV-Player freigegeben (bgCloseStart, "schließen" im Sinn des Besitzers; ob die
  // App dabei wirklich endet, ist offen), dann startet Kodi.
  // Eine App im Modul-Stapel (HOME in der App, AppControl unter der Startseite) war bis v9 ein Grund,
  // nicht zu starten ("Bitte zuerst die App mit Zurück/Exit beenden"; der einzige Weg des Launchers,
  // sie zu beenden, ist EXIT, und der endet auf Live-TV). Entscheidung des Besitzers 08.11.2026
  // ("ich will sobald kodi gestartet wird das alle anderen beendet werden"): seit v10 beendet die
  // Kodi-Kachel auch diese App (uhStart, Abschnitt "App unter der Startseite beenden") und startet
  // danach Kodi auf dem bekannten Weg. Das ist eine ausdrückliche Ausnahme von Schutzregel 4
  // (Modul-Stapel über AppControl hinweg: popAllModule('app')) und Schutzregel 7 (Zustand des
  // Launchers: AppControl verschwindet, nach Netflix openFromNetflix), nur für dieses OK auf der
  // eigenen Startseite und nur mit Aufrufen, die der Launcher selbst mit genau diesen Werten
  // benutzt. Schutzregel 2 gilt weiter: DMP erst, wenn AppControl weg ist (derselbe Schritt wie
  // EXIT/Medien), kodiPlay bleibt streng (kpGuard). Abgelehnt wie bisher bleibt: ein anderes
  // App-Modul (hiMedia, DLNA, Miracast ...), eine App im Start/Ende, DIAL, Sonderzustände des
  // Launchers und ein fremdes DMP (uhApp). Wird Kodi anders gestartet (von Hand), gibt flex.js
  // nichts frei und beendet nichts.
  function startKodi() {
    if (Date.now() - kodi.askedAt < 10000) { log('Kodi: Start schon angefordert'); return; }
    if (bgc) {
      // App unter der Startseite wird nach einem Abbruch noch beendet (passives Warten, bgc.kodi
      // false; bei bgc.kodi kommt handleTileKey gar nicht hierher): dieses OK führt den Ablauf
      // wieder als Kodi-Start (uhRearm), sonst ein Hinweis statt eines stillen Verwerfens
      if (bgc.app) {
        var re = bgc.kodi ? 'Kodi-Start läuft' : uhRearm(bgc);
        if (!re) return;
        log('Kodi: ' + bgc.label + ' wird noch beendet, kein erneuter Start (' + re + ')');
        kodiToast(bgc.kodi ? bgc.label + ' wird noch beendet …' : 'Kodi-Start abgebrochen – bitte gleich noch einmal wählen', 3000);
        return;
      }
      log('Kodi: es wird gerade eine Hintergrund-App freigegeben');
      return;
    }
    if (kodi.active || kodiActive()) {
      if (kodiMinimized()) { kodiRestore(); return; }
      kodiToast('Kodi läuft schon', 3000);
      return;
    }
    if (!noAppInStack()) {
      // typisch nach HOME aus YouTube/Netflix: die App liegt noch unter der Startseite -> beenden
      var app = uhApp();
      if (typeof app === 'object') { uhStart(app); return; }
      log('Kodi: App unter der Startseite nicht beendbar (' + app + ')');
      // 'stopping' ohne AppControl, von unserem Ablauf hinterlassen (die App hat ihr Ende nie
      // gemeldet, uhStale): es gibt keine App zum Beenden, "Zurück/Exit" hülfe nicht. Erst der
      // nächste App-Start löst den Zustand im Launcher; den Zustand selbst nie anfassen (Schutzregel 7)
      var stale = app === 'kein AppControl' ? uhStaleNow() : null;
      if (stale) {
        log('Kodi: App-Ende nie gemeldet (stopping ohne AppControl)');
        kodiToast(stale.label + ' hat ihr Ende nicht gemeldet: Kodi geht erst nach dem nächsten App-Start', 5000);
        return;
      }
      log('Kodi: App im Hintergrund, kein Start');
      kodiToast('Bitte zuerst die App mit Zurück/Exit beenden', 4000);
      return;
    }
    var sig = frontSig();
    if (!homeIdle() || !uiReadyNow() || dialogUp() || !sig) {
      log('Kodi: Startseite nicht frei, kein Start');
      kodiToast('Kodi kann gerade nicht starten', 3000);
      return;
    }
    var m = bgMarks();
    if (bgAny(m) && !bgCovered(m)) {
      var block = bgCloseBlock();
      if (!block) {
        var names = bgNames(m);
        log('Kodi: ' + names + ' im Hintergrund pausiert, TV-Player wird vor dem Start freigegeben');
        kodiToast(names + ' pausiert: TV-Player wird für Kodi freigegeben …', BG_CLOSE_MAX_MS + BG_SETTLE_MS + 1000);
        bgCloseStart(m, true, kodiAfterClose);
        return;
      }
      // geht nicht (z. B. DMP gehört gerade anderen): Kodi trotzdem, Hinweis E1 wie bisher
      log('Kodi: Hintergrund-Apps nicht freigebbar (' + block + ')');
    }
    // Verwaistes DMP ohne Hintergrund-App (z. B. Schoner -> Prime Video -> Exit): für die
    // Kodi-Sitzung mit eigenem DMP-Befehl übernehmen (frischer Wechsel auf Medien, Schutzregel 2:
    // von uns umgeschaltet), solange appFree() noch gilt, also VOR der Startanforderung (danach
    // zählt Kodi als App). kpKodiGone verlässt es nach Kodis Ende; startet Kodi nicht, verlässt es
    // scheduleDmpExit.
    var adopt = appFree() && dmpOrphan();
    if (adopt) {
      dmpOwn = true;
      try { window.UI.store.commit('Source/setCurrentSource', 'DMP'); } catch (e) { log('DMP-Fehler: ' + e); }
      log('Kodi: verwaistes DMP übernommen (' + mpInfo() + '), DMP angefordert');
    }
    if (kodiRequest(sig, '')) { if (adopt) kp.dmp = true; }
    else if (adopt) scheduleDmpExit('Kodi nicht gestartet', 'kodi');
  }

  // Ergebnis von bgCloseStart beim Kodi-Start. done: Kodi starten, DMP gehört der Kodi-Sitzung
  // (kp.dmp: kodiPlay benutzt es, kpKodiGone verlässt es nach Kodis Ende). timeout (DMP nicht
  // bestätigt): Kodi trotzdem, kodiPlay streng mit dem Hinweis E1 wie bisher; das vielleicht noch
  // kommende DMP gehört trotzdem der Kodi-Sitzung (kp.dmp), damit es nach Kodis Ende verlassen wird.
  // abort: kein Kodi; nach einer Taste bzw. einem Wechsel innerhalb des Launchers (bgExitAfter) DMP
  // wieder verlassen (scheduleDmpExit wartet auf DMP und prüft beim Feuern neu), nach App-Start,
  // Dialog oder STR gehören Quelle und Player anderen.
  function kodiAfterClose(res, why, c) {
    if (res === 'abort') {
      log('Kodi: Start abgebrochen (' + why + ')');
      var exit = bgExitAfter(res, why, c);
      // Wechsel innerhalb des Launchers (z. B. Alle Apps nach dem Stopp-Ereignis einer per Alle Apps
      // gestarteten App, AppControl.js:986): Kodi einfach noch einmal wählen
      kodiToast(exit && why === 'Modulwechsel' ? 'Kodi-Start abgebrochen: bitte Kodi noch einmal wählen' :
        'Kodi-Start abgebrochen', 4000);
      if (exit) scheduleDmpExit('Kodi-Start abgebrochen', 'close');
      else log('DMP bleibt (Kodi-Start abgebrochen: ' + why + ')');
      return;
    }
    var ours = res === 'done' || c.sent;   // DMP stammt von uns (schon vorher bzw. eben angefordert)
    // Startbedingungen von startKodi beim Feuern neu prüfen (Schutzregel 3)
    var sig = frontSig();
    if (!homeIdle() || !uiReadyNow() || dialogUp() || !sig || sig !== c.sig || !noAppInStack()) {
      log('Kodi: Startseite nach der Freigabe nicht frei, kein Start');
      kodiToast('Kodi kann gerade nicht starten', 3000);
      if (ours) scheduleDmpExit('Kodi nicht gestartet', 'close');
      return;
    }
    if (kodiRequest(sig, res === 'done' ? c.names : '')) {
      if (ours) kp.dmp = true;
    } else if (ours) {
      scheduleDmpExit('Kodi nicht gestartet', 'close');
    }
  }

  // Startanforderung schreiben (Bedingungen hat der Aufrufer eben geprüft). closed = Namen der eben
  // freigegebenen Apps (nur für den Hinweis)
  function kodiRequest(sig, closed) {
    if (!kodiFile('start', String(Math.floor(Date.now() / 1000)))) {
      kodiToast('Kodi kann nicht gestartet werden', 4000);
      return false;
    }
    kodi.askedAt = Date.now();
    kodi.sig = sig;
    // ein noch offener DMP-Ausstieg (Quelle LAST) darf nicht unter Kodi feuern; stammt er von
    // unserer Freigabe, übernimmt die Kodi-Sitzung das DMP (verlässt es nach Kodis Ende)
    if (dmpExit) {
      if ((dmpExit.rel === 'close' || dmpExit.rel === 'kodi') && dmpOwn) kp.dmp = true;
      dmpExit = null;
      log('DMP bleibt (Kodi)');
    }
    // E1: ein nur pausiertes YouTube/Netflix sperrt den TV-Player (kodiPlay, appFreeCore), außer der
    // Nutzer hat ihn freigegeben (bgRel, E1 b). Sonst startet Kodi trotzdem, der Hinweis nennt die
    // Folge und den Ausweg.
    var tvFree = appFreeCore(true);
    kodiToast(tvFree ? 'Kodi startet …' + (closed ? ' (TV-Player frei)' : '')
      : 'Kodi startet … YouTube/Netflix ist im Hintergrund pausiert: Filme spielt Kodi selbst (kein 4K). ' +
        'Abhilfe: eine andere App starten und mit Exit beenden.', KODI_START_MS);
    log('Kodi: Start angefordert' + (tvFree ? (closed ? ' (' + closed + ' freigegeben)' : '')
      : ' (YouTube/Netflix pausiert: TV-Player gesperrt, E1)'));
    return true;
  }

  // ---- Hintergrund-Apps freigeben (E1 b, Entscheidung des Besitzers 2026-10-29) ----
  // Nach dem Verlassen von YouTube bzw. Netflix stehen runningOnBack bzw. runningOnBackForNetflix
  // (selten auch LauncherHis.openFromNetflix): die App ist nur pausiert (YouTube: Cobalt onSuspend
  // -> "paused"; Netflix: Stopp heißt dort ':am,am,:backgm=netflix'), OA:29355. Der Launcher löscht
  // die Merker nur beim nächsten App-Start ("started"/"resumed", OA:29334) oder über DIAL
  // (OA:29411/29434/29436). Einen Aufruf, der eine pausierte App beendet, hat er nicht: EXIT, LAST
  // und stopAllNativeApp enden alle mit gesetzten Merkern. Schutzregel 2 sperrt darum DMP
  // (kodiPlay, Diashow), bis irgendeine App startet.
  // Unser DMP-Wechsel ist für den App-Manager ein App-Start: Source/setCurrentSource('DMP') = Grund 4
  // UI_START_APP (OA:23976-23992), wie hiMedia/DLNA ihn auslösen. Ein vorne laufendes YouTube hat
  // er dabei NICHT beendet, sondern pausiert: LOG2:2682 "runtask appId(Youtube) action(stop)", dann
  // Cobalt "onSuspend, change App Status to Paused" und AppStatus "paused" (LOG2:2746) -- genau der
  // Zustand, für den runningOnBack steht. Eine schon pausierte App bleibt nach allem, was bekannt
  // ist, pausiert im Speicher (öffnet sie wieder, geht es dort weiter, wo sie war). "Schließen" im
  // Sinn des Besitzers (Kodi-Kachel bzw. "App schließen") heißt hier darum nur: mit seiner
  // Zustimmung auf DMP schalten, warten, bis DMP steht und die Reaktion des Launchers durch ist
  // (bgCloseStep), und den TV-Player für Kodi freigeben. Die Hinweise sagen "TV-Player frei", nie
  // "geschlossen".
  // Die Merker selbst bleiben stehen (die schreibt nur der Launcher). bgRel merkt sich, welche
  // Merker der Nutzer freigegeben hat:
  // - done (DMP bestätigt): kodiPlay (kpGuard, kpCanTouch: appFreeCore(true)) und die DMP-Ausstiege
  //   nach unserer Freigabe bzw. nach Kodi (leaveDmp: appFreeCore('exit')) sehen darüber hinweg;
  // - exit (unser DMP-Befehl ist raus, aber abgebrochen bzw. ohne Bestätigung): nur der Ausstieg aus
  //   diesem DMP sieht darüber hinweg (der Nutzer hat dem Umschalten zugestimmt, also auch dem
  //   Zurückschalten), kodiPlay bleibt streng (E1 a).
  // Bildschirmschoner, Start-Haken und alle anderen Aufrufer bleiben streng (appFree()). Nie
  // aufgeweicht: AppControl im Stapel, App-Module, starting/stopping, Systemdialoge, fremdes DMP
  // (ein verwaistes DMP, dmpOrphan, ist nicht fremd: die Freigabe schaltet es selbst neu).
  // Die Freigabe verfällt bei INIT_LOADING/STR (fx.hard), sobald eine App im Stapel auftaucht (dann
  // wurde wieder eine benutzt) oder wenn der Launcher alle Merker gelöscht hat (bgRelTick); ein
  // Hot-Reload gibt sie weiter (bgRelSnap).
  // Am TV offen (P7/P8, Testplan TVPLAYER-DESIGN.md E1): ob der App-Manager eine schon pausierte App
  // beim DMP-Wechsel doch beendet (beim nächsten Start Kaltstart statt Fortsetzen) und wie der
  // Launcher dann je nach Startweg reagiert ('stopped' -> Startweg 1/15 popAllModule +
  // openLauncher, 3/5 Alle Apps, sonst Live-TV, OA:29355-29408). Darum erst nach bestätigtem DMP und
  // BG_SETTLE_MS Ruhe weiter.
  var BG_CLOSE_MAX_MS = 5000;   // so lange höchstens auf DMP warten
  var BG_CLOSE_STEP_MS = 250;   // Prüftakt (jeder Schritt prüft alles neu, Schutzregel 3)
  var BG_SETTLE_MS = 1000;      // nach DMP noch so lange Ruhe (LOG2: AppStatus ~1 s nach dem Befehl)
  var bgRel = null;  // { rob, robn, ofn, hard, done, exit }: vom Nutzer freigegebene Merker (Übernahme bei Hot-Reload: bgRelAdopt)
  var bgc = null;    // laufende Freigabe (bgCloseStart)

  // Hintergrund-Merker des Launchers (nur lesen); null = nicht lesbar
  function bgMarks() {
    try {
      var UI = window.UI, ac = UI.store.state.AppControl, st = launcherState(UI.store);
      if (!ac) return null;
      return { rob: !!ac.runningOnBack, robn: !!ac.runningOnBackForNetflix, ofn: !!(st && st.openFromNetflix) };
    } catch (e) {
      return null;
    }
  }

  function bgAny(m) { return !!m && (m.rob || m.robn || m.ofn); }

  function bgNames(m) {
    var n = [];
    if (m && (m.robn || m.ofn)) n.push('Netflix');
    if (m && m.rob) n.push('YouTube');
    return n.join(' und ');
  }

  // Alle gesetzten Merker in m sind in r freigegeben
  function bgRelHas(r, m) {
    return !!r && !!m && r.hard === fx.hard && (!m.rob || r.rob) && (!m.robn || r.robn) && (!m.ofn || r.ofn);
  }

  // ... und die Freigabe kam bis DMP (done): gilt für kodiPlay und die DMP-Ausstiege
  function bgCovered(m) { return !!bgRel && bgRel.done && bgRelHas(bgRel, m); }

  // ... oder unser DMP-Befehl ist raus (exit): gilt nur für den Ausstieg aus DMP (leaveDmp)
  function bgExitCovered(m) { return !!bgRel && (bgRel.done || bgRel.exit) && bgRelHas(bgRel, m); }

  function bgRelDrop(why) {
    if (!bgRel) return;
    bgRel = null;
    log('Freigabe der Hintergrund-Apps verfällt (' + why + ')');
  }

  // 1-s-Takt: Freigabe nur, solange seitdem keine App benutzt wurde
  function bgRelTick() {
    if (!bgRel || bgc) return;
    if (bgRel.hard !== fx.hard) bgRelDrop('STR oder Neustart');
    else if (!noAppInStack()) bgRelDrop('App im Modul-Stapel');
    else if (!bgAny(bgMarks())) bgRelDrop('Merker gelöscht');
  }

  // Darf jetzt freigegeben werden? '' = ja, sonst der Grund. Schutzregel 2 ohne die Merker selbst.
  // Ein verwaistes DMP (dmpOrphan) sperrt nicht: bgCloseStart schaltet dann selbst neu auf DMP.
  function bgCloseBlock() {
    if (!homeIdle() || !uiReadyNow() || dialogUp()) return 'Startseite nicht frei';
    if (!noAppInStack()) return 'App im Modul-Stapel';
    if (bgc || ss.state !== 'off' || gal.open || kp.sid || kp.foreign) return 'beschäftigt';
    if (dmpActive() && !dmpOwn && !dmpOrphan()) return 'DMP gehört anderen';
    return '';
  }

  // Freigabe beginnen (Aufrufer hat bgCloseBlock() geprüft, direkt auf eine Taste des Nutzers):
  // Freigabe vormerken, auf DMP schalten; bgCloseStep prüft alle 250 ms. then(res, why, c) mit res
  // 'done' | 'timeout' | 'abort'. forKodi: jede fremde Taste bricht ab (der Kodi-Start ist der
  // verzögerte Seiteneffekt, Schutzregel 3); beim Menü nicht (LAST prüft scheduleDmpExit selbst).
  // Fremd heißt: jede Taste außer OK auf der Kodi-Kachel samt ihren Wiederholungen. Die zählt onKey
  // in c.own mit (Capture-Phase: dort kommen auch die Wiederholungen an, die UI.js nie an
  // MainTiles gibt, app.js L9731; nach einem Hot-Reload läuft onKey erst nach diesem Start und
  // zählt auch das OK, das ihn ausgelöst hat).
  function bgCloseStart(m, forKodi, then) {
    var c = { kodi: !!forKodi, then: then, t0: Date.now(), hard: fx.hard, sig: frontSig(), keys: fx.keys,
      own: 0, dmpAt: 0, sent: false, names: bgNames(m) };
    bgRel = { rob: !!m.rob, robn: !!m.robn, ofn: !!m.ofn, hard: fx.hard, done: false, exit: false };
    bgc = c;
    if (dmpActive() && dmpOwn) {
      // unser DMP steht schon: die App lag schon bei unserem Umschalten pausiert darunter, ein
      // zweiter Befehl ändert nichts
      bgCloseEnd(c, 'done', 'DMP stand schon');
      return;
    }
    // Verwaistes DMP (bgCloseBlock hat dmpOrphan geprüft): nicht stillschweigend übernehmen, sondern
    // wie ohne DMP selbst neu anfordern (Grund 4, jetzt bei pausierter App) und wie sonst auf DMP und
    // Ruhe warten; danach ist es unser DMP (Schutzregel 2: von uns umgeschaltet)
    var orphan = dmpActive();
    c.sent = true;   // ab hier ist der Ausstieg aus DMP mit freigegeben (bgCloseEnd, exit)
    if (dmpExit && dmpExit.rel === 'close' && dmpOwn) {
      // unser DMP-Befehl einer eben abgebrochenen Freigabe ist noch unterwegs: keinen zweiten
      // schicken; der geplante Ausstieg entfällt, bgCloseStep wartet auf dieses DMP
      dmpExit = null;
      log('Schließen: ' + c.names + ' (DMP schon angefordert, ' + (forKodi ? 'Kodi-Start' : 'Kachel-Menü') + ')');
      later(function () { bgCloseStep(c); }, BG_CLOSE_STEP_MS);
      return;
    }
    dmpOwn = true;   // vor dem Umschalten (wie ss.dmp/kp.dmp); ssTick lässt es stehen, solange bgc läuft
    try { window.UI.store.commit('Source/setCurrentSource', 'DMP'); } catch (e) { log('DMP-Fehler: ' + e); }
    log('Schließen: ' + c.names + ' (' + (orphan ? 'verwaistes DMP übernommen, ' + mpInfo() + ', ' : '') + 'DMP angefordert, ' +
      (forKodi ? 'Kodi-Start' : 'Kachel-Menü') + ')');
    later(function () { bgCloseStep(c); }, BG_CLOSE_STEP_MS);
  }

  function bgCloseStep(c) {
    if (bgc !== c) return;
    var why = '';
    if (c.hard !== fx.hard) why = 'STR oder Neustart';
    else if (!uiReadyNow() || dialogUp()) why = 'Systemdialog';
    else if (!noAppInStack()) why = 'App gestartet';
    else if (!c.sig || frontSig() !== c.sig) why = 'Modulwechsel';
    else if (c.kodi && fx.keys !== c.keys + c.own) why = 'Taste';
    if (why) { bgCloseEnd(c, 'abort', why); return; }
    var now = Date.now(), home = homeIdle();
    // homeIdle kann kurz fehlen, wenn der Launcher die Startseite neu aufbaut (popAllModule +
    // openLauncher nach 'stopped', OA:29386): dann weiter warten, frontSig ist ja gleich geblieben
    if (!dmpActive()) c.dmpAt = 0;
    else if (!c.dmpAt) { c.dmpAt = now; log('Schließen: DMP aktiv nach ' + (now - c.t0) + ' ms'); }
    if (c.dmpAt && home && now - c.dmpAt >= BG_SETTLE_MS) { bgCloseEnd(c, 'done', ''); return; }
    if (!c.dmpAt && now - c.t0 >= BG_CLOSE_MAX_MS) { bgCloseEnd(c, 'timeout', 'DMP nicht bestätigt'); return; }
    if (now - c.t0 >= BG_CLOSE_MAX_MS + BG_SETTLE_MS) { bgCloseEnd(c, 'abort', 'Startseite nicht frei'); return; }
    later(function () { bgCloseStep(c); }, BG_CLOSE_STEP_MS);
  }

  function bgCloseEnd(c, res, why) {
    if (bgc !== c) return;
    bgc = null;
    var same = c.hard === fx.hard && noAppInStack();
    // volle Freigabe nur mit bestätigtem DMP, solange seitdem keine App und kein STR kam
    var keep = res === 'done' || (res === 'abort' && c.dmpAt > 0 && same);
    // sonst, wenn unser DMP-Befehl raus ist: nur für den Ausstieg aus diesem DMP; kodiPlay bleibt
    // streng (E1 a). Ob wirklich ausgestiegen wird, entscheiden der Aufrufer (bgExitAfter) und
    // scheduleDmpExit beim Feuern.
    var exit = !keep && c.sent && same;
    if (keep && bgRel) bgRel.done = true;
    else if (exit && bgRel) bgRel.exit = true;
    else bgRel = null;
    if (res === 'done') log('Hintergrund-Apps freigegeben: ' + c.names + ' pausiert, TV-Player frei' + (why ? ' (' + why + ')' : ''));
    else log('Schließen ' + (res === 'timeout' ? 'ohne Ergebnis' : 'abgebrochen') + ': ' + c.names + ' (' + why + ')' +
      (keep ? '' : exit ? ', nur DMP-Ausstieg freigegeben' : ', keine Freigabe'));
    try { c.then(res, why, c); } catch (e) { log('Schließen-Fehler: ' + e); }
  }

  // Nach einem Abbruch bzw. dem Zeitlimit DMP wieder verlassen? Nur, wenn unser DMP-Befehl raus ist
  // (c.sent), und nur nach einer Taste des Nutzers ('Taste'), nach dem Zeitlimit (DMP kommt evtl.
  // noch), nach zu langer Unruhe der Startseite und nach einem Wechsel innerhalb des Launchers ohne
  // App ('Modulwechsel' mit LauncherHis vorne, z. B. Alle Apps, das der Launcher nach dem Stopp-
  // Ereignis einer per Alle Apps gestarteten App öffnet, AppControl.js:986). Nie nach App-Start,
  // Systemdialog oder STR. Ob dann wirklich umgeschaltet wird, entscheidet scheduleDmpExit beim
  // Feuern (Schutzregeln 2 und 3).
  function bgExitAfter(res, why, c) {
    if (!c || !c.sent) return false;
    if (res === 'timeout' || why === 'Taste' || why === 'Startseite nicht frei') return true;
    if (why !== 'Modulwechsel') return false;
    try { return window.UI.getCurrentModuleId() === 'LauncherHis' && noAppInStack(); } catch (e) { return false; }
  }

  // resetOwnUi (INIT_LOADING, STR): laufendes Schließen ohne Folgen beenden; Quelle und Player
  // gehören jetzt dem Launcher (wie kpForeign)
  function bgCloseAbort(why) {
    if (bgc) {
      var app = !!bgc.app;
      bgc = null;
      dmpOwn = false;
      log((app ? 'App beenden' : 'Schließen') + ' abgebrochen (' + why + ')');
    }
    bgRelDrop(why);
  }

  // ---- App unter der Startseite beenden (v10, Entscheidung des Besitzers 08.11.2026) ----
  // "ich will sobald kodi gestartet wird das alle anderen beendet werden": OK auf der Kodi-Kachel
  // beendet auch eine App, die nach HOME noch unter der Startseite liegt (AppControl im Stapel, für
  // den Launcher checkIsAppOn). Ausnahme von Schutzregel 4 und 7 nur für genau diesen Fall, nur direkt
  // auf das OK (handleTileKey, keine Wiederholung). Nur Aufrufe, die der Launcher selbst mit genau
  // diesen Werten benutzt, in der Reihenfolge seiner eigenen Wege (Medien-Kachel bei einer App unter
  // der Startseite: startHiPageApp "himedia", "PubFunc.js:4796", popAllModule + pushSubModule hiMedia,
  // dessen created() schaltet auf DMP; EXIT: popAllModule + LAST im selben Schritt, 92.js L1939-1941):
  // 1. UI.popAllModule('app'): entfernt nur Module vom Typ "app" (ct, app.js L9985-9990; hier nur
  //    AppControl, uhApp prüft das), so auch MainTiles bei AccuWeather (92.js L1420) und der Launcher
  //    nach dem Ende einer App aus "Alle Apps" (AppControl.js:986). Startseite, MainTiles-Instanz und
  //    unsere Hülle bleiben, kein Tastenschloss. AppControl.vue beforeDestroy (~16 ms später, UVA:2747-
  //    2797) ruft stopCurrentApp: currentAMState 'stopping', appIsOn false (AppControl.js:172/179).
  // 2. Gleich danach Source/setCurrentSource('DMP') (Grund 4): APM beendet die App, die es vorne hält
  //    (YouTube: "runtask appId(Youtube) action(stop)", Cobalt onSuspend, AppStatus 'paused' ~1 s
  //    danach, LOG2:2664-2746), und startet DMP (~1,2 s).
  // Weil der Zustand dann 'stopping' ist, verarbeitet der Launcher das AppStatus ohne zu navigieren
  // ("sysStoped=false", AppControl.js:934/958; nur 'stopped' und :1118, das bei LauncherHis vorne
  // nichts tut). Danach der bekannte Weg (uhDone): DMP steht und ist unseres, die eben gesetzten
  // Merker freigeben (bgCloseStart: "DMP stand schon"), Kodi anfordern; ohne Merker (Prime,
  // Browser-Apps) direkt kodiRequest mit kp.dmp. Nach Netflix zusätzlich openFromNetflix löschen, wie
  // openLauncher es nach dem Ende einer per Kachel gestarteten App tut (AppControl.js:1036, OA:7605;
  // flex.js benutzt die Mutation schon in showHomeAtBoot): sonst startet ZURÜCK bzw. HOME auf der
  // Startseite Netflix neu (92.js L1938, app.js L1187). Gelöscht wird, sobald das Ende beobachtet
  // ist (uhOfnClear: AppStatus verarbeitet, in beiden Phasen), dazu beim Abbruch mit DMP-Ausstieg und
  // in uhDone (dort nur noch Nachprüfung); nie, wenn wieder eine App da ist (auch nicht, wenn ZURÜCK
  // bzw. HOME des Nutzers Netflix eben selbst neu gestartet hat) oder LauncherHis nicht vorne ist.
  // Bekannte Lücke: meldet Netflix ihr Ende erst nach UH_MAX_MS (Abbruch "meldet ihr Ende nicht"),
  // bleibt openFromNetflix stehen, wie nach der Freigabe über bgCloseStart (v9, dort nie gelöscht).
  // Nie: setAppCallBackFun (setzen nur die EXIT-Wege; ohne AppStatus bliebe es stehen und das nächste
  // ZURÜCK einer App ließe eine AppControl-Seite hängen), AppControl/stopCurrentApp selbst (macht
  // beforeDestroy), popAllModule() ohne Typ bzw. 'module' (nähme die Startseite mit), pushModule,
  // sendCMD, startThirdPartyApp.
  // Der Ablauf läuft als bgc (c.app): Kachel-Menü, Kodi-Start, Verwaist-Prüfung, bgRelTick und ssTick
  // (dmpOwn) warten wie bei der Freigabe; onKey zählt OK auf der Kodi-Kachel samt Wiederholungen als
  // eigene Taste (c.own). uhStep prüft alle 250 ms alles neu (Schutzregel 3).
  // Abbruch (kein Kodi):
  // - STR/INIT_LOADING (resetOwnUi -> bgCloseAbort), Systemdialog, App gestartet: sofort; Quelle und
  //   Player gehören dann anderen, DMP bleibt.
  // - Taste, Wechsel innerhalb des Launchers mit LauncherHis vorne (z. B. Alle Apps, falls er doch
  //   nach Startweg navigiert: AppControl.js:986), DMP nicht bestätigt, Startseite nicht frei: den
  //   DMP-Ausstieg (scheduleDmpExit, prüft beim Feuern neu) erst planen, wenn das AppStatus verarbeitet
  //   ist; launcherSig enthält currentAMState, ein früher geplanter Ausstieg verfiele sonst als "Modul-
  //   oder App-Wechsel". Bis dahin passiv warten (c.kodi false), höchstens bis UH_MAX_MS. Ein
  //   erneutes OK auf der Kodi-Kachel in dieser Zeit führt den Ablauf nach denselben Prüfungen wie
  //   beim ersten OK wieder als Kodi-Start (uhRearm), sonst Hinweis "bitte gleich noch einmal wählen".
  // - Andere Modulwechsel (Live-TV, Einstellungen ...): DMP bleibt.
  // - Warten: höchstens UH_MAX_MS auf AppStatus und DMP, stehen beide, noch BG_SETTLE_MS Ruhe (wie
  //   bgCloseStep); "Startseite nicht frei" nur, wenn die Ruhezeit um ist und homeIdle() fehlt.
  // - Meldet die App ihr Ende nie (bleibt 'stopping'): DMP bleibt (leaveDmp lehnte ohnehin ab); erst
  //   der nächste App-Start löst den Zustand im Launcher. Bis dahin sperrt 'stopping' Kodi-Start,
  //   Diashow und DMP-Ausstieg; die Kodi-Kachel sagt das (uhStale), statt "Zurück/Exit beenden".
  //   Risiko nur bei Netflix (Entscheidung des Besitzers: Netflix wird trotzdem beendet; am TV prüfen,
  //   ob nach dem DMP-Wechsel "AppControl.js:958 sysStoped=false" kommt): startet der Nutzer in
  //   diesem Zustand Netflix neu (Netflix-Taste, Kachel), setzt PubFunc startThirdPartyApp
  //   restartFlag (app.js L8124: 'stopping', gleicher Name netflix; YouTube/amazon stehen in der
  //   Ausnahmeliste, browser nicht in der Namensliste), das kein 'started'/'resumed' löscht. Das
  //   nächste 'paused' dieser Netflix-Sitzung verwirft der Launcher dann (AppControl.js:909): nach
  //   ZURÜCK in Netflix bleibt eine leere AppControl-Seite, bis HOME/EXIT.
  // Hot-Reload: stop() beendet den Ablauf ohne Folgen (nur die Ausstiegs-Freigabe geht weiter, wie bei
  // bgc); die neue Instanz setzt ihn nicht fort, DMP bleibt bis zur nächsten Taste (Kodi-Kachel: "DMP
  // stand schon", ZURÜCK/EXIT: LAST des Launchers).
  // Am TV offen: Reaktion von Netflix, Prime ('amazon') und Browser-Apps auf den DMP-Wechsel (gemessen
  // nur YouTube), RCLaunchNetFlag (nicht lesbar), ob MainTiles beim Neuaufbau der Startseite (nur
  // ohne 'stopping') neu entsteht.
  var UH_MAX_MS = 8000;   // so lange höchstens auf AppStatus und DMP warten (danach noch BG_SETTLE_MS Ruhe, wie bgCloseStep)
  var UH_NAMES = { youtube: 'YouTube', netflix: 'Netflix', amazon: 'Prime Video' };
  // { name, label, hard }: unser letzter Ablauf endete mit "App meldet ihr Ende nicht" ('stopping'
  // ohne AppControl); verfällt, sobald der Launcher den Zustand ändert (uhStaleTick) bzw. mit uhStart
  var uhStale = null;

  // Name für Hinweise: Kachel der Startseite mit derselben App (tileApp), sonst bekannt bzw. 'App'
  function uhLabel(name, local) {
    try {
      var st = launcherState(window.UI.store), list = (st && st.mainTileData) || [];
      for (var i = 0; i < list.length; i++) {
        var a = tileApp(list[i]);
        if (a && a.name === name && (name !== 'browser' || a.local === local)) return a.label;
      }
    } catch (e) { /* unten */ }
    return UH_NAMES[name] || 'App';
  }

  // App unter der Startseite, die die Kodi-Kachel jetzt beenden darf: { name, local, sm, label }, sonst
  // der Grund (Text). Nur lesen; Zustand des Launchers: AppControl-Store (FA:17280-17320).
  function uhApp() {
    try {
      var UI = window.UI, ac = UI.store.state.AppControl;
      if (!UI.isSubModuleExist('AppControl', 'AppControl') || !UI.isModuleExist('AppControl')) return 'kein AppControl';
      // popAllModule('app') nähme hiMedia, DLNA, Miracast, PvrMedia, AccuWeather mit
      for (var i = 0; i < APP_MODULES.length; i++) {
        if (APP_MODULES[i] !== 'AppControl' && UI.isModuleExist(APP_MODULES[i])) return 'App-Modul ' + APP_MODULES[i];
      }
      if (!homeIdle() || !uiReadyNow() || dialogUp()) return 'Startseite nicht frei';
      if (ss.state !== 'off' || gal.open || bgc || kp.sid || kp.foreign || kodiPending() || kodi.active ||
        kodiActive()) return 'beschäftigt';
      // nur 'started': sonst setzt beforeDestroy kein 'stopping' und der Launcher navigierte nach dem
      // Startweg (Alle Apps, Live-TV ...)
      if (!ac || ac.currentAMState !== 'started') return 'App im Zustand ' + (ac ? ac.currentAMState : 'unlesbar');
      var name = typeof ac.currentAppName === 'string' ? ac.currentAppName : '';
      if (!name) return 'App unbekannt';
      if (String(ac.stopMethod) === '10') return 'DIAL';   // stopCurrentApp schickte dann selbst Befehle
      if (ac.restartFlag || ac.browserFlag || ac.settingRestoreStartFlag || ac.stopAppCallBackFun ||
        ac.messageProcessBySTR === false) return 'Sonderzustand des Launchers';
      if (dmpActive() && !dmpOwn) return 'DMP gehört anderen';
      var local = typeof ac.currentLocalAppName === 'string' ? ac.currentLocalAppName : '';
      return { name: name, local: local, sm: ac.startMethod, label: uhLabel(name, local) };
    } catch (e) {
      return 'unlesbar';
    }
  }

  // Direkt auf das OK (startKodi hat uhApp() eben geprüft): AppControl entfernen, auf DMP schalten
  function uhStart(app) {
    var UI = window.UI, m0 = bgMarks() || { rob: false, robn: false, ofn: false }, gone = false;
    log('Kodi: ' + app.label + ' liegt unter der Startseite (' + app.name + ', Startweg ' + app.sm + '), wird beendet');
    try { UI.popAllModule('app'); } catch (e) { log('popAllModule-Fehler: ' + e); }
    // entscheidend ist, ob AppControl jetzt weg ist (dann zerstört der Launcher es ohnehin)
    try { gone = !UI.isSubModuleExist('AppControl', 'AppControl'); } catch (e2) { gone = false; }
    if (!gone) {
      // API fehlt oder wirkt nicht: nicht umschalten (im Zweifel weniger), wie bis v9
      log('Kodi: AppControl nicht entfernt, kein Start');
      kodiToast('Bitte zuerst die App mit Zurück/Exit beenden', 4000);
      return;
    }
    var c = { app: true, kodi: true, then: null, t0: Date.now(), hard: fx.hard, sig: '', keys: fx.keys, own: 0,
      dmpAt: 0, acAt: 0, sent: true, name: app.name, label: app.label, names: app.label, first: true, why: '',
      noEnd: false };
    uhStale = null;   // die App war eben 'started': ein früheres 'stopping' ist erledigt
    // Freigabe vormerken wie bgCloseStart, mit den Merkern, die das Beenden gleich setzt (YouTube bzw.
    // Netflix 'paused': runningOnBack bzw. runningOnBackForNetflix), dazu die schon gesetzten.
    // done/exit erst am Ende (uhDone -> bgCloseStart bzw. uhEnd); stop() gibt exit weiter.
    bgRel = { rob: m0.rob || app.name === 'youtube', robn: m0.robn || app.name === 'netflix', ofn: m0.ofn,
      hard: fx.hard, done: false, exit: false };
    bgc = c;
    dmpOwn = true;   // vor dem Umschalten (wie bgCloseStart); ssTick lässt es stehen, solange bgc läuft
    try { UI.store.commit('Source/setCurrentSource', 'DMP'); } catch (e) { log('DMP-Fehler: ' + e); }
    c.sig = frontSig();   // erst nach popAllModule: AppControl ist jetzt weg
    kodiToast(app.label + ' wird beendet, Kodi startet …', UH_MAX_MS + BG_SETTLE_MS + 1000);
    later(function () { uhStep(c); }, BG_CLOSE_STEP_MS);
  }

  // Wieder eine App da (AppControl, App-Modul) bzw. eine im Start; unlesbar = ja
  function uhAppBack(ac) {
    try {
      var UI = window.UI;
      if (!ac || UI.isSubModuleExist('AppControl', 'AppControl')) return true;
      for (var i = 0; i < APP_MODULES.length; i++) if (UI.isModuleExist(APP_MODULES[i])) return true;
      return ac.currentAMState === 'starting';
    } catch (e) {
      return true;
    }
  }

  function uhStep(c) {
    if (bgc !== c) return;
    var now = Date.now(), ac = null;
    try { ac = window.UI.store.state.AppControl || null; } catch (e) { ac = null; }
    var st = ac ? ac.currentAMState : '';
    // baut der Launcher die Startseite neu auf (nur ohne 'stopping': popAllModule + openLauncher,
    // AppControl.js:1036), die neue MainTiles-Instanz gleich umhüllen (Kodi-Kachel nie über den
    // originalen Startpfad, Schutzregel 8); tut nichts, solange unsere Hülle sitzt
    try { patchMainTiles(); } catch (e) { /* 1-s-Takt versucht es wieder */ }
    var why = '';
    if (c.hard !== fx.hard) why = 'STR oder Neustart';
    else if (!uiReadyNow() || dialogUp()) why = 'Systemdialog';
    else if (uhAppBack(ac)) why = 'App gestartet';
    if (why) {
      if (c.kodi) {
        c.why = why;
        log('Kodi: Start abgebrochen (' + why + ')');
        kodiToast('Kodi-Start abgebrochen', 4000);
      } else c.why += ', dann ' + why;
      uhEnd(c, false);
      return;
    }
    if (c.first) {
      c.first = false;
      // 'stopping' + appIsOn false belegt: beforeDestroy lief, das AppStatus wird ohne Navigation
      // verarbeitet; bleibt es 'started', navigiert der Launcher nach dem Startweg (Alle Apps, Live-TV)
      log('App beenden: AppControl weg' + (st === 'stopping' && ac.appIsOn === false ? ' (stopping)' :
        ', Zustand ' + st + (st === 'started' ? ' (ohne stopping: Launcher navigiert evtl. nach Startweg)' : '')) +
        ' nach ' + (now - c.t0) + ' ms');
    }
    if (!c.acAt && st === 'stopped') {
      c.acAt = now;
      log('App beenden: AppStatus verarbeitet nach ' + (now - c.t0) + ' ms');
      // Ende beobachtet (in beiden Phasen; erst nach der uhAppBack-Prüfung oben): openFromNetflix wie
      // openLauncher löschen, sonst startet ZURÜCK/HOME auf der Startseite Netflix auch nach einem Abbruch neu
      uhOfnClear(c, 'Netflix beendet, wie openLauncher');
    }
    if (!dmpActive()) c.dmpAt = 0;
    else if (!c.dmpAt) { c.dmpAt = now; log('App beenden: DMP aktiv nach ' + (now - c.t0) + ' ms'); }
    if (c.kodi) {
      var a = '';
      if (!c.sig || frontSig() !== c.sig) a = 'Modulwechsel';
      else if (fx.keys !== c.keys + c.own) a = 'Taste';
      else if (c.acAt && c.dmpAt && homeIdle() && now - Math.max(c.acAt, c.dmpAt) >= BG_SETTLE_MS) { uhDone(c); return; }
      // Zeitlimits wie bgCloseStep: UH_MAX_MS für AppStatus und DMP; stehen beide, noch BG_SETTLE_MS
      // Ruhe dazu (eine App, die nach 7-8 s endet, startet Kodi noch). Ist auch die Ruhezeit um,
      // fehlt nur noch homeIdle(): erst dann "Startseite nicht frei"
      else if (!c.acAt || !c.dmpAt) {
        if (now - c.t0 >= UH_MAX_MS) a = !c.acAt ? 'App meldet ihr Ende nicht' : 'DMP nicht bestätigt';
      } else if (now - c.t0 >= UH_MAX_MS + BG_SETTLE_MS && now - Math.max(c.acAt, c.dmpAt) >= BG_SETTLE_MS) {
        a = 'Startseite nicht frei';
      }
      if (a) uhAbort(c, a);
    } else if (c.acAt) {
      uhEnd(c, true);
    } else if (now - c.t0 >= UH_MAX_MS) {
      c.why += ', App meldet ihr Ende nicht';
      c.noEnd = true;
      uhEnd(c, false);
    }
    if (bgc === c) later(function () { uhStep(c); }, BG_CLOSE_STEP_MS);
  }

  // Kodi-Start abgebrochen (Taste, Modulwechsel, Zeitlimit): DMP wieder verlassen? Wie bgExitAfter,
  // aber erst, wenn das AppStatus verarbeitet ist (sonst passiv weiter warten, uhStep)
  function uhAbort(c, why) {
    c.kodi = false;
    c.why = why;
    if (why === 'App meldet ihr Ende nicht') c.noEnd = true;
    var again = false;
    if (why === 'Modulwechsel') {
      try {
        var UI = window.UI;
        again = UI.getCurrentModuleId() === 'LauncherHis' && !UI.isSubModuleExist('AppControl', 'AppControl');
        for (var i = 0; again && i < APP_MODULES.length; i++) if (UI.isModuleExist(APP_MODULES[i])) again = false;
      } catch (e) { again = false; }
    }
    log('Kodi: Start abgebrochen (' + why + ')');
    kodiToast(why === 'App meldet ihr Ende nicht' ? 'Kodi-Start abgebrochen: ' + c.label + ' meldet ihr Ende nicht' :
      again ? 'Kodi-Start abgebrochen: bitte Kodi noch einmal wählen' : 'Kodi-Start abgebrochen', 4000);
    var exit = why === 'Taste' || why === 'DMP nicht bestätigt' || why === 'Startseite nicht frei' || again;
    if (!exit) uhEnd(c, false);
    else if (c.acAt) uhEnd(c, true);
    else log('App beenden: warte auf das AppStatus, dann DMP verlassen');
  }

  // OK auf der Kodi-Kachel während des passiven Wartens nach einem Abbruch (Taste, Wechsel nach Alle
  // Apps; c.kodi false, AppControl ist schon weg, das AppStatus fehlt noch): den Ablauf wieder als
  // Kodi-Start führen, statt das OK zu verwerfen (Wunsch des Besitzers 08.11.2026: Kodi wählen = App
  // beenden und Kodi starten). Ein direktes OK des Nutzers auf der eigenen Startseite wie das erste
  // (dieselbe Ausnahme von Schutzregel 4/7), darum dieselben Prüfungen wie startKodi/uhApp; es kommt
  // kein Aufruf an den Launcher dazu (popAllModule und DMP sind schon raus). onKey hat dieses OK in
  // der Capture-Phase schon gezählt: c.keys = fx.keys; jede weitere fremde Taste bricht wieder ab
  // (Schutzregel 3), uhDone prüft vor kodiRequest alles neu. c.t0 bleibt: UH_MAX_MS zählt ab dem
  // DMP-Wechsel (so lange darf die App für ihr Ende brauchen). '' = wieder Kodi-Start, sonst der Grund.
  function uhRearm(c) {
    if (bgc !== c || !c.app || c.kodi) return 'läuft';
    if (c.hard !== fx.hard) return 'STR oder Neustart';
    var sig = frontSig(), ac = null;
    if (!sig || !homeIdle() || !uiReadyNow() || dialogUp()) return 'Startseite nicht frei';
    try { ac = window.UI.store.state.AppControl || null; } catch (e) { ac = null; }
    if (uhAppBack(ac)) return 'App gestartet';
    if (ss.state !== 'off' || gal.open || kp.sid || kp.foreign || kodiPending() || kodi.active ||
      kodiActive()) return 'beschäftigt';
    if (ac.restartFlag || ac.browserFlag || ac.settingRestoreStartFlag || ac.stopAppCallBackFun ||
      ac.messageProcessBySTR === false) return 'Sonderzustand des Launchers';
    if (dmpActive() && !dmpOwn) return 'DMP gehört anderen';
    c.kodi = true;
    c.sig = sig;
    c.keys = fx.keys;
    c.own = 0;
    c.why = '';
    log('Kodi: erneut gewählt, ' + c.label + ' wird weiter beendet');
    kodiToast(c.label + ' wird beendet, Kodi startet …', UH_MAX_MS + BG_SETTLE_MS + 1000);
    return '';
  }

  // openFromNetflix löschen wie openLauncher (AppControl.js:1036, OA:7605), nur wenn Netflix beendet
  // ist: unser Ablauf (gleicher fx.hard), keine App wieder da (uhAppBack: dann gehört der Merker der
  // neuen Sitzung, z. B. nach ZURÜCK/HOME des Nutzers; uhStep prüft das vorher selbst, hier zur
  // Absicherung), LauncherHis vorne und der Merker steht
  function uhOfnClear(c, why) {
    if (c.name !== 'netflix' || c.hard !== fx.hard) return;
    try {
      var UI = window.UI, ac = UI.store.state.AppControl || null, lst = launcherState(UI.store);
      if (uhAppBack(ac) || UI.getCurrentModuleId() !== 'LauncherHis' || !lst || !lst.openFromNetflix) return;
      UI.store.commit('LauncherHis/setOpenFromNetflix', false);
      log('App beenden: openFromNetflix gelöscht (' + why + ')');
    } catch (e) { log('openFromNetflix-Fehler: ' + e); }
  }

  // Ende ohne Kodi. exit: unser DMP-Befehl ist raus, nur dessen Ausstieg freigeben (kodiPlay bleibt
  // streng, E1 a) und ihn planen (scheduleDmpExit prüft beim Feuern neu); sonst bleibt DMP.
  // c.noEnd (Zeitlimit ohne AppStatus): 'stopping' bleibt im Launcher stehen -> uhStale
  function uhEnd(c, exit) {
    if (bgc !== c) return;
    bgc = null;
    exit = exit && c.hard === fx.hard;   // nur zur Absicherung: uhStep beendet bei neuem fx.hard selbst ohne exit
    if (exit && bgRel) bgRel.exit = true;
    else bgRel = null;
    uhStale = c.noEnd && c.hard === fx.hard ? { name: c.name, label: c.label, hard: c.hard } : null;
    log('App beenden abgebrochen: ' + c.label + ' (' + c.why + ')' + (exit ? ', DMP wird verlassen' : ''));
    if (exit) {
      // Taste, DMP nicht bestätigt, Startseite nicht frei, Wechsel innerhalb des Launchers: AppControl
      // ist weg, "zurück zu Netflix unter der Startseite" gibt es nicht mehr (nie nach STR, Dialog,
      // App-Start: dann gehören Quelle und Launcher anderen). exit kommt nur mit c.acAt, dort ist der
      // Merker in der Regel schon gelöscht: hier Nachprüfung
      uhOfnClear(c, 'Kodi-Start abgebrochen');
      scheduleDmpExit('Kodi-Start abgebrochen', 'close');
    } else log('DMP bleibt (Kodi-Start abgebrochen: ' + c.why + ')');
  }

  // Steht der Launcher noch in dem Zustand, den unser Ablauf hinterlassen hat ('stopping' derselben
  // App, gleicher fx.hard)?
  function uhStaleValid() {
    var s = uhStale, ac = null;
    if (!s || s.hard !== fx.hard) return false;
    try { ac = window.UI.store.state.AppControl || null; } catch (e) { ac = null; }
    return !!ac && ac.currentAMState === 'stopping' && ac.currentAppName === s.name;
  }

  // ... und nichts im Stapel, das man beenden könnte (kein AppControl, kein App-Modul): uhStale, sonst null
  function uhStaleNow() {
    if (!uhStaleValid()) return null;
    try {
      var UI = window.UI;
      if (UI.isSubModuleExist('AppControl', 'AppControl')) return null;
      for (var i = 0; i < APP_MODULES.length; i++) if (UI.isModuleExist(APP_MODULES[i])) return null;
      return uhStale;
    } catch (e) {
      return null;
    }
  }

  // 1-s-Takt: uhStale verfällt, sobald der Launcher den Zustand ändert (spätes AppStatus, nächster
  // App-Start) oder nach STR/Neustart
  function uhStaleTick() {
    if (uhStale && !uhStaleValid()) {
      uhStale = null;
      log('App beenden: Zustand stopping erledigt');
    }
  }

  // App beendet, DMP steht (unseres), Startseite seit BG_SETTLE_MS ruhig: Kodi auf dem bekannten Weg
  function uhDone(c) {
    bgc = null;
    log('App beenden: ' + c.label + ' beendet nach ' + (Date.now() - c.t0) + ' ms');
    // schon beim AppStatus gelöscht (uhStep); hier nur Nachprüfung
    uhOfnClear(c, 'wie openLauncher');
    // Startbedingungen von startKodi beim Feuern neu prüfen (Schutzregel 3)
    var sig = frontSig(), block = bgCloseBlock();
    if (block || !sig || kodi.active || kodiActive() || kodiPending()) {
      log('Kodi: Startseite nach dem Beenden nicht frei, kein Start (' + (block || 'Kodi') + ')');
      kodiToast('Kodi kann gerade nicht starten', 3000);
      if (bgRel) bgRel.exit = true;
      scheduleDmpExit('Kodi nicht gestartet', 'close');
      return;
    }
    var m = bgMarks();
    // YouTube/Netflix jetzt pausiert: Merker freigeben; DMP steht schon -> sofort 'done', kodiRequest
    if (bgAny(m)) { bgCloseStart(m, true, kodiAfterClose); return; }
    bgRel = null;
    // Prime, Browser-Apps: keine Merker. DMP gehört der Kodi-Sitzung (kpKodiGone verlässt es nach
    // Kodis Ende); startKodis Übernahme eines verwaisten DMP greift hier nicht (dmpOwn steht)
    if (kodiRequest(sig, c.label)) kp.dmp = true;
    else scheduleDmpExit('Kodi nicht gestartet', 'close');
  }

  function stopKodi(why) {
    log('Kodi: beenden (' + why + ')');
    kodiFile('stop', String(Math.floor(Date.now() / 1000)));
    kodi.askedAt = 0;
    // kleine Ladeanzeige, bis Kodi weg ist (Besitzer 17.11.2026: Kodi braucht beim Beenden oft einige Sekunden);
    // nur beim ersten Aufruf je Ende (stopKodi kommt im 1-s-Takt wieder, solange das Modul vorne bleibt)
    if (!kodi.stopAsked) { kodi.stopAsked = true; kodiToast('Kodi wird beendet …', 25000); }
  }

  // Läuft Kodi? kodi-run.sh schreibt solange alle 2 s ein neues Lebenszeichen nach
  // flexkodi/running. Solange Kodi läuft, bekommt der Launcher keine Tasten: ohne diese Abfrage
  // hielte er den TV für unbenutzt und startete den Bildschirmschoner hinter (bzw. über) Kodi.
  // Lebenszeichen "<jetzt> <letzte Taste> <bereit>" (Sekunden; bereit = 1, sobald Kodis Fenster
  // da ist und es die Fernbedienung übernommen hat).
  // Frisch heißt: der INHALT hat sich in den letzten 15 Takten geändert (D5). Früher zählte die
  // Uhrzeit darin (|jetzt - t| < 15 s); ein NTP-Sprung beim Start hätte so einen laufenden Film
  // beendet und LAST unter Kodi auslösen können (REV:28-42). "Weg" = Datei fehlt zwei Takte
  // hintereinander (kodi-run.sh löscht sie nach Kodis Ende, KRUN:63).
  var KODI_HB_TICKS = 15;               // 15 Takte (s) ohne neuen Inhalt = steht
  var KODI_HB_HOLD_TICKS = 60;          // höchstens so lange ab STR_SUSPEND nicht lesen (siehe kodiHbForget)
  // undefined = noch nie gelesen; hold = Takte, in denen nicht gelesen wird (Standby)
  var kodiHb = { raw: undefined, age: KODI_HB_TICKS, miss: 0, hold: 0 };

  function kodiHbTick() {               // aus kodiTick, 1 s
    if (kodiHb.hold > 0) { kodiHb.hold--; return; }
    var raw = null;
    try { raw = window.hisense.file.read('flexkodi/running', 1); } catch (e) { raw = null; }
    if (typeof raw !== 'string') {       // fehlt (oder Lesefehler): erst beim zweiten Mal gilt es
      if (++kodiHb.miss >= 2) { kodiHb.raw = null; kodiHb.age = KODI_HB_TICKS; }
      return;
    }
    kodiHb.miss = 0;
    if (kodiHb.raw === null) kodiHb.age = 0;                    // neu angelegt: kodi-run.sh schreibt
    else if (kodiHb.raw !== undefined && raw !== kodiHb.raw) kodiHb.age = 0;
    else if (kodiHb.age < KODI_HB_TICKS) kodiHb.age++;          // erste Lesung (undefined) = unbekannt = alt
    kodiHb.raw = raw;
  }

  // Lebenszeichen vergessen (resetOwnUi: STR, INIT_LOADING): Kodi gilt erst wieder als laufend,
  // wenn sich running danach ändert, wie nach dem Booten. Sonst hielte der Stand von vor dem Standby
  // Kodi beim Aufwachen für laufend, und der Start-Haken ließe Live-TV statt der Startseite stehen
  // (startModule() läuft beim Aufwachen vor jedem Zeitgeber; v6 las dort die Uhrzeit in running,
  // die nach dem Standby alt war). onSuspend sperrt zusätzlich das Lesen bis zum Aufwachen, weil
  // kodi-run.sh bis zum Einfrieren noch schreiben kann (Kodi beendet sich erst nach flexkodi/stop).
  function kodiHbForget() {
    kodiHb.raw = undefined;
    kodiHb.age = KODI_HB_TICKS;
    kodiHb.miss = 0;
  }

  // Stand des letzten Takts (höchstens 1 s alt); liest nicht selbst. Ein beim Boot liegen
  // gebliebenes running (Stromausfall) gilt als alt, bis es sich ändert. lastKey bleibt eine
  // Uhrzeit und dient nur der Abschaltautomatik (kodiTick), dort ist ein Uhrsprung harmlos.
  function kodiState() {
    var raw = kodiHb.raw;
    if (typeof raw !== 'string' || kodiHb.age >= KODI_HB_TICKS) return null;
    var f = raw.split(' ');
    // min: Kodi ist nach Home ausgeblendet (18.11.2026), läuft aber; die Fernbedienung hat der Launcher
    return { lastKey: parseInt(f[1], 10) || 0, ready: parseInt(f[2], 10) === 1, min: parseInt(f[3], 10) === 1 };
  }

  function kodiActive() {
    return kodiState() !== null;
  }

  // Home in Kodi (Besitzer 18.11.2026: "Kodi minimieren, andere Apps beenden es dann"): Kodi blendet sich aus und gibt
  // die Fernbedienung frei (EvdevInputHandler::Minimize). Die Kodi-Kachel holt es zurück: dieselbe Start-Anforderung,
  // kodi.sh start legt bei minimiertem Kodi "restore" an, statt Kodi zu starten. Andere Apps/Module beenden es wie bisher
  // ("Modul vorne"). Nach KODI_MIN_STOP_MS minimiert beendet flex.js es, damit Bildschirmschoner und Standby wieder normal laufen.
  var KODI_MIN_STOP_MS = 10 * 60 * 1000;
  function kodiMinimized() {
    var st = kodiState();
    return !!(st && st.min);
  }

  function kodiRestore() {
    if (!kodiFile('start', String(Math.floor(Date.now() / 1000)))) {
      kodiToast('Kodi kann nicht zurückgeholt werden', 4000);
      return;
    }
    log('Kodi: zurückholen');
  }

  function kodiPending() {
    return kodi.askedAt > 0 && Date.now() - kodi.askedAt < KODI_START_MS;
  }

  // Im 1-s-Takt (ssTick): Kodi läuft oder startet -> true (dann kein Bildschirmschoner)
  function kodiTick() {
    kodiHbTick(); // Lebenszeichen genau einmal je Takt lesen (D5)
    var st = kodiState(), active = st !== null;
    if (active && !kodi.active) {
      kodi.active = true;
      kodi.stopAsked = false;
      kodi.exitHint = false;
      kodi.keySeen = false;
      if (!kodi.sig) kodi.sig = frontSig(); // von Hand gestartet
      log('Kodi läuft');
    } else if (!active && kodi.active) {
      kodi.active = false;
      kodi.sig = '';
      log('Kodi beendet');
      if (kodi.stopAsked || kodi.exitHint) { kodi.stopAsked = false; kodi.exitHint = false; kodiToast('', 0); }
      kodi.keySeen = false;
      kodi.minSince = 0;
      // kodiPlay: Datei fehlt -> kodi-run.sh hat aufgeräumt (KRUN:63): Film stoppen, DMP-Ausstieg
      // vormerken. Nur unverändert (Kodi und kodi-run.sh hängen oder wurden getötet): Film
      // stoppen, DMP bleibt (D18).
      try { kpKodiGone(kodiHb.raw === null ? 'Lebenszeichen weg' : 'Lebenszeichen steht', kodiHb.raw === null); }
      catch (e) { log('kodiPlay-Fehler: ' + e); }
      if (kodi.askedAt) {
        // beendet, bevor es bereit war (Absturz beim Start o. Ä.)
        kodi.askedAt = 0;
        kodiToast('Kodi ist nicht gestartet', 4000);
      }
    }
    // Vorgemerkten DMP-Ausstieg erst planen, wenn running 3 Takte fehlt (länger als der 2-s-Takt
    // von kodi-run.sh); kommt es vorher wieder (Kodi neu gestartet), bleibt DMP. Beides steht vor
    // dem frühen return unten, damit es auch nach Kodis Ende läuft.
    if (kp.exitPending && (active || kodiHb.raw !== null)) kp.exitPending = false;
    else if (kp.exitPending && kodiHb.miss >= 3) { kp.exitPending = false; scheduleDmpExit('Kodi beendet', 'kodi'); }
    if (!active) setLauncherClass('flex-kp-video', false); // D16: nie ohne laufendes Kodi stehen lassen
    // Kodi beendet sich (aus seinem Menü): es gibt die Fernbedienung frei (Taste beim Launcher) bzw. sein Lebenszeichen
    // seit 5 s steht; bis "Kodi beendet" kleine Anzeige (Besitzer 17.11.2026: beim Beenden hängt Kodi oft einige Sekunden).
    // Läuft das Lebenszeichen ohne freigegebene Fernbedienung wieder, war es nur eine Pause: Anzeige weg.
    if (active && st.min) {
      // minimiert: Tasten beim Launcher sind gewollt; ein "Kodi wird beendet …" aus den Sekunden vor dem
      // nächsten Lebenszeichen wieder weg
      if (!kodi.minSince) { kodi.minSince = Date.now(); log('Kodi: minimiert (Home)'); }
      kodi.keySeen = false;
      if (kodi.exitHint) { kodi.exitHint = false; kodiToast('', 0); }
      if (!kodi.stopAsked && Date.now() - kodi.minSince > KODI_MIN_STOP_MS) stopKodi('minimiert seit 10 min');
    } else if (active) {
      if (kodi.minSince) { kodi.minSince = 0; log('Kodi: wieder vorne'); }
      var exiting = kodi.keySeen || kodiHb.age >= 5;   // Lebenszeichen alle 2 s: 5 s = zwei Takte fehlen
      if (exiting && !kodi.exitHint && !kodi.stopAsked) {
        kodi.exitHint = true;
        kodiToast('Kodi wird beendet …', 25000);
        log('Kodi: beendet sich (' + (kodi.keySeen ? 'Fernbedienung frei' : 'Lebenszeichen steht') + ')');
      } else if (!exiting && kodi.exitHint) {
        kodi.exitHint = false;
        kodiToast('', 0);
      }
    }
    // "Kodi startet …" bleibt, bis Kodi wirklich bereit ist
    if (st && st.ready && kodi.askedAt) {
      kodi.askedAt = 0;
      kodiToast('', 0);
    } else if (st && kodi.askedAt && !kodiPending()) {
      kodi.askedAt = 0; // läuft, meldet aber nie "bereit" (z. B. Fernbedienung nicht übernommen)
    }
    if (st && !st.min) {
      // Der Launcher sieht keine Tasten, solange Kodi die Fernbedienung hält: seine Zeitgeber
      // (VIDAA-Bildschirmschoner, Auto-Standby nach 3-4 h) liefen sonst ab und holten ein Modul
      // bzw. den Standby-Dialog über Kodi. Den Bildschirmschoner immer zurücksetzen, den
      // Auto-Standby nur, solange in Kodi Tasten gedrückt werden (unbenutzt geht der TV weiter
      // wie gewohnt in den Standby). refreshGlobalTimer: app.js, tut nichts ohne Zeitgeber.
      try {
        window.UI.refreshGlobalTimer('setArtScreen');
        if (st.lastKey && Date.now() / 1000 - st.lastKey < 120) window.UI.refreshGlobalTimer('AutoSleepTimeOut');
      } catch (e) { /* ignorieren */ }
    }
    if (!active && !kodiPending()) {
      if (kodi.askedAt) {
        kodi.askedAt = 0;
        kodi.sig = '';
        kodiToast('Kodi ist nicht gestartet', 4000);
        log('Kodi: kein Lebenszeichen, Start aufgegeben');
        // DMP vom Schließen vor dem Start (kodiAfterClose) gehört keiner Sitzung mehr: verlassen
        // wie nach Kodis Ende (kp.exitPending, siehe oben)
        if (kp.dmp && !kp.sid) {
          try { kpKodiGone('Kodi nicht gestartet', true); } catch (e) { log('kodiPlay-Fehler: ' + e); }
        }
      }
      return false;
    }
    // Eine App, ein anderes Modul oder ein Systemdialog braucht Bildschirm und Fernbedienung.
    // kodiPlay: beim Dialog den Film sofort anhalten (die Startseite ist noch frei); kommt ein
    // Modul nach vorne, gehören Quelle und Player jetzt der App bzw. APM: nie mehr anfassen.
    // Sonst, sobald Kodi bereit meldet: Laufschlüssel holen und Aufträge prüfen.
    var sig = frontSig();
    if (dialogUp()) {
      try { kpEnd('Systemdialog', 'stopped', true, 'dialog'); } catch (e) { log('kodiPlay-Fehler: ' + e); }
      stopKodi('Systemdialog');
    } else if (kodi.sig && sig && sig !== kodi.sig) {
      if (kp.sid || kp.dmp) kpForeign('Modul vorne'); // ohne kodiPlay-Zustand wie v6 (dmpOwn bleibt)
      stopKodi('Modul vorne: ' + sig);
    } else if (st && st.ready) {
      try { kpKeyLoad(); kpCheckRequest(st); } catch (e) { log('kodiPlay-Fehler: ' + e); }
    }
    if (dmpExit) dmpExit = null; // kein LAST, solange Kodi läuft
    return true;
  }

  // Kurzer Hinweis unten in der Mitte (nur Anzeige, keine Tastenbehandlung)
  var kodiToastTimer = null;

  function kodiToast(text, ms) {
    var el = document.getElementById('flex-kodi-toast');
    if (kodiToastTimer) { clearTimeout(kodiToastTimer); kodiToastTimer = null; }
    if (!text) { if (el) el.className = ''; return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'flex-kodi-toast';
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent = text;
    el.className = 'show';
    kodiToastTimer = setTimeout(function () { el.className = ''; kodiToastTimer = null; }, ms);
    inst.timers.push(kodiToastTimer);
  }

  // ---- Wetter-Widget (oben rechts auf der Startseite) ----
  var WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  var MO = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  var weather = (prev && prev.weather) || null;

  function wmo(code, day) {
    // [Icon, Text] für WMO-Wettercodes (Open-Meteo)
    if (code === 0) return [day ? 'clear-day' : 'clear-night', 'klar'];
    if (code === 1) return [day ? 'clear-day' : 'clear-night', 'überwiegend klar'];
    if (code === 2) return [day ? 'partly-day' : 'partly-night', 'teils bewölkt'];
    if (code === 3) return ['cloudy', 'bedeckt'];
    if (code === 45 || code === 48) return ['fog', 'Nebel'];
    if (code >= 51 && code <= 57) return ['rain', 'Nieselregen'];
    if (code >= 61 && code <= 67) return ['rain', 'Regen'];
    if (code >= 71 && code <= 77) return ['snow', 'Schnee'];
    if (code >= 80 && code <= 82) return ['rain', 'Regenschauer'];
    if (code === 85 || code === 86) return ['snow', 'Schneeschauer'];
    if (code >= 95) return ['thunder', 'Gewitter'];
    return ['cloudy', ''];
  }

  function fetchWeather() {
    if (typeof WEATHER.lat !== 'number' || typeof WEATHER.lon !== 'number') return;
    var x = new XMLHttpRequest();
    x.open('GET', 'https://api.open-meteo.com/v1/forecast?latitude=' + WEATHER.lat + '&longitude=' + WEATHER.lon +
      '&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min' +
      '&timezone=Europe%2FBerlin&forecast_days=1');
    x.timeout = 15000;
    x.onload = function () {
      if (inst.stopped || x.status !== 200) return;
      try {
        var d = JSON.parse(x.responseText);
        weather = { t: d.current.temperature_2m, code: d.current.weather_code, day: d.current.is_day === 1,
          min: d.daily.temperature_2m_min[0], max: d.daily.temperature_2m_max[0], at: Date.now() };
        window.__flex.weather = weather;
        renderWeather();
      } catch (e) { log('Wetter-Antwort unlesbar: ' + e); }
    };
    x.send();
  }

  function renderWeather() {
    var root = document.querySelector('.launcher');
    if (!root) return;
    var el = document.getElementById('flex-weather');
    if (!el || el.parentNode !== root) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
      el = document.createElement('div');
      el.id = 'flex-weather';
      el.className = 'flex-weather';
      el.innerHTML = '<div class="fw-head"><span class="fw-city"></span><span class="fw-date"></span></div>' +
        '<div class="fw-main"><div class="fw-icon"></div><span class="fw-temp">–</span></div>' +
        '<div class="fw-desc"></div><div class="fw-mm"></div>';
      root.appendChild(el);
    }
    var now = new Date();
    el.querySelector('.fw-city').textContent = WEATHER.name;
    el.querySelector('.fw-date').textContent = WD[now.getDay()] + ' ' + now.getDate() + '. ' + MO[now.getMonth()];
    if (!weather) return;
    var w = wmo(weather.code, weather.day);
    el.querySelector('.fw-icon').style.backgroundImage = 'url(static/flex/wx-' + w[0] + '.png)';
    el.querySelector('.fw-temp').textContent = Math.round(weather.t) + '°';
    el.querySelector('.fw-desc').textContent = w[1];
    el.querySelector('.fw-mm').textContent = 'min ' + Math.round(weather.min) + '° · max ' + Math.round(weather.max) + '°';
  }

  // ---- Beim Einschalten direkt die Startseite (statt Live-TV mit der letzten Quelle) ----
  // UI.js startModule() (app.js pe(), L9637-9683) ruft im Standardzweig Mt.pushModule("LiveTV")
  // auf (L9677); Mt ist window.UI (L10260). Beim Kaltstart läuft startModule() direkt nach
  // INIT_LOADING, synchron in UI.init (L10078), beim Aufwachen aus STR in he() VOR STR_RESUME
  // (L9687). Genau diesen einen Aufruf ersetzen wir durch die Startseite.
  // Einschalten per Netflix-/YouTube-/Prime-Taste (APP_POWER_ON -> startThirdPartyApp, L9645-9651),
  // Ersteinrichtung, Hotel-Modus, Alexa und virtueller Eingang nehmen in startModule() andere Wege
  // und pushen kein Live-TV: dort greift flex.js NICHT ein. Es gibt bewusst keinen Zeitgeber, der
  // die Startseite später öffnet: der frühere 3-s-"Notnagel" nach INIT_FINISHED/STR_RESUME legte
  // sie über die gerade startende App (Audit Risiko 2). Ein HDMI-CEC-Quellenwechsel kommt danach
  // und schaltet normal um (dann ist der Haken schon wieder aus).
  // Schutzregel 7: scharf nur von INIT_LOADING bis zur Rückkehr von startModule() (bzw. von
  // STR_SUSPEND bis STR_RESUME), nie beim Resume neu schärfen, nie ersetzen, solange eine App da ist.
  var bootArmed = false;
  var disarmTimer = null;

  function armBoot(ms) {
    bootArmed = true;
    if (disarmTimer) clearTimeout(disarmTimer);
    // setTimeout statt Uhrzeit: die Systemuhr springt beim Start auf die NTP-Zeit
    disarmTimer = setTimeout(function () { bootArmed = false; }, ms);
    inst.timers.push(disarmTimer);
  }

  function disarmBoot(why) {
    if (bootArmed) log('Start-Haken entschärft (' + why + ')');
    bootArmed = false;
    if (disarmTimer) clearTimeout(disarmTimer);
    disarmTimer = null;
  }

  function hookPushModule() {
    var UI = window.UI;
    if (!UI || !UI.pushModule) return false;
    if (UI.__flexPushInst === inst) return true;
    if (!UI.__flexOrigPushModule) UI.__flexOrigPushModule = UI.pushModule;
    UI.pushModule = function (id) {
      if (id === 'LiveTV' && bootArmed && !inst.stopped) {
        disarmBoot('Live-TV-Aufruf'); // nur dieser eine Aufruf
        // im Zweifel (Fehler, App vorhanden, nicht gewünscht) das Original: Live-TV
        var swap = false;
        try { swap = homeWanted() && appFree(); } catch (e) { swap = false; }
        if (swap) {
          try {
            showHomeAtBoot();
            return undefined;
          } catch (e2) { log('showHome-Fehler: ' + e2); }
        } else {
          log('Start: Live-TV nicht ersetzt (App vorhanden oder Startseite nicht gewünscht)');
        }
      }
      return UI.__flexOrigPushModule.apply(this, arguments);
    };
    UI.__flexPushInst = inst;
    return true;
  }

  // ---- Zustand des Launchers (nur lesen) ----
  // Belege für jede API: analysis/audit-app-launch-20261028.md bzw. app.js-Zeilen unten. Jeder
  // Aufruf ist abgesichert; fehlt eine API oder wirft sie, ist das Ergebnis die vorsichtige
  // Antwort (keine App frei, Dialog offen, DMP nicht aktiv): flex.js tut dann weniger.

  // UI.isReady: Getter (app.js L10254), false vor UI.init und ab STR_SUSPEND (L9697)
  function uiReadyNow() {
    try { return window.UI.isReady === true; } catch (e) { return false; }
  }

  // SystemLayer-Dialog offen (z. B. standbyDialog_dialog, 60-s-Countdown der Abschaltautomatik),
  // oder der Standby-Dialog wartet noch in der Warteschlange: dann gehört jede Taste dem Launcher.
  // Er schließt den Dialog mit einem Druck (SystemLayer.keydown) bzw. nimmt ihn bei jeder Taste aus
  // der Warteschlange (UI.js, app.js L9727). UI.isDialogShowing (L10237 -> Rt, L10058-10059),
  // UI.isDialogInQueue (L10239 -> bt, L10060-10064). Im Zweifel: ja (Taste nicht verschlucken).
  function dialogUp() {
    try {
      var UI = window.UI;
      return !!(UI.isDialogShowing() || UI.isDialogInQueue('standbyDialog_dialog'));
    } catch (e) {
      return true;
    }
  }

  // "App" heißt hier nicht nur AppControl: Module vom Typ "app" (Konfiguration AppModules, app.js
  // L16836: hiMedia, DLNA, AppControl, AccuWeather, Miracast, PvrMedia; Typ in L9907-9910)
  // überleben HOME, denn popAllModule('module') entfernt nur Typ "module" (L9988-9991), und HOME
  // in so einem Modul legt die Startseite nur darüber (KeyEventDispatcher, L1210); HOME/BACK auf
  // der Startseite kehrt dorthin zurück (checkNativeApp, L1205-1207). Art, Free und FVP lässt
  // HOME ebenso liegen (checkModuleDecideOpenLiveTV, "PubFunc.js:4671", L8124). hiMedia (USB),
  // DLNA und Miracast schalten selbst auf DMP bzw. miracast (142.js deviceBrowser.created,
  // Source.js:507) und spielen über denselben Player (PlayMedia(...,'Media'), "hiMedia.js:2318/
  // 3138"): unser DMP/PlayMedia/MpCtrl-Stopp/LAST würde so eine Sitzung beenden. Darum die
  // Vereinigung aus AppModules, checkNativeApp und checkModuleDecideOpenLiveTV.
  var APP_MODULES = ['AppControl', 'hiMedia', 'DLNA', 'Miracast', 'PvrMedia', 'AccuWeather', 'Art', 'Free', 'FVP'];

  // Keine App vorne, im Hintergrund, im Start oder im Beenden. Der Launcher selbst prüft "App an"
  // mit isSubModuleExist('AppControl', 'AppControl') (PubFunc checkIsAppOn, app.js L8124), dazu
  // kommen die App-Module oben (UI.isModuleExist, L10022).
  // UI.store.state.AppControl ist das Store-Modul "AppControl" (app.js L8175, "AppControl:hi",
  // state oi): currentAMState kennt nur stopped/starting/started/stopping; runningOnBack =
  // YouTube pausiert, runningOnBackForNetflix = Netflix pausiert. isNetflixOn liegt in einem
  // internen Modul des Bundles (app.js L4136, nicht über window erreichbar); es wird aber nur im
  // selben Zweig wie currentAMState 'started' gesetzt (AppControl.js:846), und nach HOME aus
  // Netflix steht LauncherHis.openFromNetflix (KeyEventDispatcher, app.js L1188/L1210).
  // Nur dort verwenden, wo Quelle, Player oder Modul-Stapel berührt werden (Diashow, DMP-Ausstieg,
  // Start-Haken): runningOnBack bleibt nach jedem Verlassen von YouTube stehen ("paused" ist dort
  // der normale Weg zurück zum Launcher, L8175), bis die nächste App startet.
  // appFreeCore = Schutzregel 2 OHNE die Kodi-Bedingung: nur für kodiPlay, das selbst unter Kodi
  // läuft. Alle anderen Aufrufer benutzen appFree() (Kodi zählt dort wie eine App).
  // rel === true (nur kodiPlay): die Hintergrund-Merker zählen nicht, soweit der Nutzer sie
  // freigegeben hat und DMP bestätigt war (bgCovered, E1 b). rel === 'exit' (nur leaveDmp nach
  // unserer Freigabe bzw. nach Kodi): ebenso, oder unser DMP-Befehl dazu ist schon raus
  // (bgExitCovered). Ohne rel streng wie bisher (E1 a).
  function appFreeCore(rel) {
    try {
      var UI = window.UI;
      if (UI.isSubModuleExist('AppControl', 'AppControl')) return false;
      for (var i = 0; i < APP_MODULES.length; i++) if (UI.isModuleExist(APP_MODULES[i])) return false;
      var ac = UI.store.state.AppControl;
      if (!ac) return false;
      // Nur die Übergänge zählen. "started" allein beweist keine App: der Launcher setzt es auch
      // für vorgeladene, unsichtbare Apps und setzt es nicht immer zurück (am TV 2026-10-28:
      // "started" ohne AppControl-Modul und ohne App-Namen -> Diashow blieb für immer aus). Eine
      // echte App (vorne oder per HOME pausiert) liegt im Modul-Stapel, siehe oben.
      if (ac.currentAMState === 'starting' || ac.currentAMState === 'stopping') return false;
      var st = launcherState(UI.store);
      var m = { rob: !!ac.runningOnBack, robn: !!ac.runningOnBackForNetflix, ofn: !!(st && st.openFromNetflix) };
      if (!bgAny(m)) return true;
      if (rel === true) return bgCovered(m);
      return rel === 'exit' && bgExitCovered(m);
    } catch (e) {
      return false;
    }
  }

  function appFree(rel) {
    // Kodi (läuft oder ist angefordert) zählt wie eine App: Quelle und Player bleiben in Ruhe
    try { if (kodiPending() || kodiActive()) return false; } catch (e) { return false; }
    return appFreeCore(rel);
  }

  // Unsere DMP-Quelle ist noch die aktuelle: getCurrentAppSource() liefert JSON mit sourceName
  // (DLNA.js:101, app.js L8175: JSON.parse(...).sourceName === "dmp"; am TV gesehen, GUIDE.md).
  // Unlesbar = nicht aktiv (dann wird nichts umgeschaltet).
  // 17.11.2026: Der Wert des App-Managers bleibt nach einem Wechsel auf einen HDMI-Eingang auf "dmp" stehen (HDMI ist für
  // ihn keine App; am TV: getCurrentAppSource "dmp", GetCurrentPath() und Source-Store "HDMI1"). kodiPlay hielt DMP darum
  // für aktiv, schaltete nicht um, und Kodis Film lief hinter dem HDMI-Bild (PS5). Steht im echten Pfad ein physischer
  // Eingang, ist DMP nicht aktiv; ist der Pfad nicht lesbar, gilt wie bisher der App-Manager-Wert.
  function dmpActive() {
    var raw, dmp = false;
    try { raw = window.modeljs.source.getCurrentAppSource(); } catch (e) { return false; }
    if (raw && typeof raw === 'object') dmp = raw.sourceName === 'dmp';
    else {
      try {
        var o = JSON.parse(String(raw));
        dmp = !!o && o.sourceName === 'dmp';
      } catch (e2) {
        return false;
      }
    }
    if (!dmp) return false;
    try {
      var src = window.modeljs.source, path = src && typeof src.GetCurrentPath === 'function' ? src.GetCurrentPath() : null;
      if (typeof path === 'string' && /^(HDMI|AV|COMP|YPBPR|VGA|SCART|TV|ATV|DTV)/i.test(path)) return false;
    } catch (e3) { /* Pfad nicht lesbar: App-Manager-Wert gilt */ }
    return true;
  }

  // Fingerabdruck von Modul-Stapel und App-Zustand: ändert sich bei jedem Modulwechsel und
  // App-Start (UI.getCurrentModuleId L10154 -> gt L10020, UI.getCurrentSubModuleId L10186 ->
  // St L10026). '' = nicht lesbar (zählt als geändert).
  function launcherSig() {
    try {
      var UI = window.UI, ac = UI.store.state.AppControl || {};
      return [UI.getCurrentModuleId(), UI.getCurrentSubModuleId(), ac.currentAMState, ac.currentAppName,
        UI.isSubModuleExist('AppControl', 'AppControl')].join('|');
    } catch (e) {
      return '';
    }
  }

  // Token für verzögerte Seiteneffekte (Schutzregel 3): keys zählt jeden Tastendruck, hard jedes
  // INIT_LOADING/STR_SUSPENDING/STR_SUSPEND/STR_RESUME; Modulwechsel und App-Start erkennt
  // launcherSig(). Ein Zeitgeber merkt sich alles beim Planen und vergleicht beim Feuern.
  var fx = { keys: 0, hard: 0 };

  var lastKeyAt = 0;

  // Tasten: auf window in der Capture-Phase, registriert beim Laden von flex.js und damit VOR dem
  // Tasten-Handler des Launchers (UI.init, app.js L10073). Verschluckt (stopImmediatePropagation)
  // wird nur, solange unsere eigene Oberfläche vorne ist (Schutzregel 5): Bildschirmschoner auf der
  // Startseite bzw. Seite "Bilder" über "Alle Apps", UI.isReady, keine App vorne (die Seite
  // "Bilder" zusätzlich: gar kein AppControl), kein Dialog; dazu OK
  // auf unserem Eintrag "Bilder". keyup: nur das der zuletzt verschluckten Taste (gleicher
  // keyCode, höchstens 1,5 s), statt wie früher jedes keyup in einem 1,5-s-Fenster.
  var swallowUp = { code: -1, until: 0 };

  // Diese Tasten beenden den Bildschirmschoner und wirken trotzdem sofort (nicht abfangen):
  // Power (VK_POWER 400; abgefangen reagierte der TV erst auf einen späteren Druck), Lautstärke
  // (411/412) und Stumm (413). Codes aus der Tastentabelle des Launchers (CONST.KEY, app.js L2025).
  var SS_PASS_KEYS = { 400: 1, 411: 1, 412: 1, 413: 1 };
  // App- und Systemtasten (CONST.KEY, app.js L2025): Netflix 616, Amazon 617, YouTube 619,
  // Alle Apps 615, Einstellungen 567, Quelle 505, Home 36, Launcher 547, Exit 27. Sie beenden
  // Bildschirmschoner bzw. Seite "Bilder" und gehen an den Launcher (Schutzregel 5): eine App-Taste
  // startet die App wie ohne Mod, und der verzögerte DMP-Ausstieg sieht den App-Start und schaltet
  // nicht um (Risiko 1).
  var SYS_KEYS = { 616: 1, 617: 1, 619: 1, 615: 1, 567: 1, 505: 1, 36: 1, 547: 1, 27: 1 };

  // Quittung an VIDAA für jede Taste, die flex.js selbst verbraucht. Das System liefert die
  // nächste Taste erst aus, wenn die vorige quittiert ist; sonst wartet es ~5 s (gemessen: Tasten
  // auf der Seite "Bilder" kamen im 5-s-Takt an). Normal quittiert der Tasten-Handler des
  // Launchers (UI.js ve() -> Ce(): guiService.sendResult(behandelt, 1 DOWN | 2 REPEAT | 8 UP,
  // keyCode)), den wir hier mit stopImmediatePropagation überspringen.
  // NUR die Instanz des Launchers benutzen (UI.guiService), NIE guijs.createService() aufrufen:
  // eine zweite Instanz übernimmt die Ereignisse des nativen Dienstes, und AppControl bekommt
  // kein "appEventMessage" (App gestartet/fortgesetzt) mehr -> App-Starts bleiben hängen
  // (am TV passiert: Launcher wartet 10 s, "appcontrol has been auto unlocked", App unsichtbar).
  // Nach einem Hot-Reload (prev gesetzt) läuft der Handler des Launchers VOR diesem und hat die
  // Taste schon quittiert: dann nicht noch einmal (doppelte Quittung, Audit Risiko 8).
  // isTrusted wird bewusst NICHT geprüft: ob Cobalt echte Fernbedienungstasten als trusted meldet,
  // ist am TV ungeprüft; meldet es sie als untrusted, fehlte jede Quittung und jede verschluckte
  // Taste hinge wieder ~5 s. Debug-Proben dürfen deshalb keine DOM-Tasten erzeugen (Schutzregel 10).
  var ACK_KEYS = !prev;

  function ackKey(e) {
    if (!ACK_KEYS) return;
    var svc = window.UI && window.UI.guiService;
    if (!svc || typeof svc.sendResult !== 'function') return;
    try {
      svc.sendResult(true, e.type === 'keydown' ? (e.repeat ? 2 : 1) : 8, e.keyCode);
    } catch (err) { log('sendResult-Fehler: ' + err); }
  }

  // Taste verschlucken; bei keydown auch das zugehörige keyup (gleicher keyCode, 1,5 s)
  function swallow(e) {
    ackKey(e);
    if (e.type === 'keydown') swallowUp = { code: e.keyCode, until: Date.now() + 1500 };
    try {
      e.stopImmediatePropagation();
      e.preventDefault();
    } catch (err) { /* ignorieren */ }
  }

  function onKey(e) {
    var k = e.keyCode, down = e.type === 'keydown', pass = SS_PASS_KEYS[k] === 1;
    if (down) {
      lastKeyAt = Date.now();
      idle = 0;
      fx.keys++; // macht verzögerte Seiteneffekte ungültig (Schutzregel 3)
      // Volume and mute leave the source selection itself unchanged. Power does not.
      if(sourceChoice&&(k===411||k===412||k===413))sourceChoice.keys=fx.keys;
      // Repeated OK on the same pending Denon choice is not navigation away.
      if(sourceChoice&&k===13&&window.UI&&UI.getCurrentSubModuleId()==='AllInputs'){
        var pendingInput=focusedDenonInput(inputVm());
        if(pendingInput&&pendingInput.denonPort===sourceChoice.port)sourceChoice.keys=fx.keys;
      }
      // ... außer OK auf der Kodi-Kachel, solange vor dem Kodi-Start freigegeben wird (bgCloseStep):
      // auch jede Wiederholung (UI.js gibt sie nicht an MainTiles, app.js L9731) und, nach einem
      // Hot-Reload, das OK, das die Freigabe eben gestartet hat (der Launcher-Handler lief vor diesem)
      if (k === 13 && bgc && bgc.kodi) {
        // hat der Launcher die Startseite eben neu aufgebaut (neue MainTiles-Instanz), sie vor der
        // Weitergabe umhüllen: dieses OK darf nie den originalen Startpfad der Kodi-Kachel nehmen
        // (Schutzregel 8); tut nichts, solange unsere Hülle sitzt
        try { patchMainTiles(); } catch (err0) { /* 1-s-Takt versucht es wieder */ }
        // beim Beenden der App unter der Startseite zählt OK auch, solange MainTiles beim Neuaufbau fehlt
        if (kodiTileFocused() || (bgc.app && !mainTilesVm())) bgc.own++;
      }
      // Denon-Modul: Zurück (solange die Konsolenwahl noch auf der Startseite bzw. in den Quellen wartet) und App-Tasten
      // verwerfen eine laufende Konsolenwahl; Lautstärke ändert an einem wartenden Kodi-/App-Start nichts. Die Taste geht
      // unverändert weiter.
      denonKeyDown(k);
      // Kodi hält die Fernbedienung exklusiv; kommt trotzdem eine Taste an, hat Kodi sie beim Beenden freigegeben
      if (kodi.active && !pass && !kodiMinimized()) kodi.keySeen = true;
    } else if (swallowUp.code === k) {
      // keyup zur selbst verschluckten Taste (außer ein Dialog ist inzwischen offen)
      var ownUp = Date.now() < swallowUp.until;
      swallowUp.code = -1;
      if (ownUp && !dialogUp()) {
        swallow(e);
        return;
      }
    }
    var dn = window.__flexDenon;
    if (dn && dn.isOpen()) {
      if (dn.isTyping && dn.isTyping()) return;
      if (!galleryValid()) { dn.close(); return; }
      if (pass || (SYS_KEYS[k] === 1 && k !== 27)) {
        if (k !== 411 && k !== 412 && k !== 413) dn.close();
        return;
      }
      if (down && !e.repeat && !(k === 13 && Date.now() - dn.openedAt() < 300)) dn.key(k);
      swallow(e); return;
    }
    if (down && k === 13 && window.UI && window.UI.getCurrentSubModuleId() === 'AllApps' && isDenonEntry(allAppsVm())) {
      if (!e.repeat && dn && galleryValid()) dn.open();
      swallow(e); return;
    }
    if (down && window.UI && UI.getCurrentSubModuleId() === 'AllInputs') {
      var input = focusedDenonInput(inputVm());
      if (input && (k === 13 || k === 77 || k === 567 || k === CONST.KEY.VK_MENU)) {
        if (k === 13 && !e.repeat) chooseDenonSource(input.denonPort);
        swallow(e);return;
      }
    }
    // Kachel-Menü: die Tasten selbst behandelt handleTileKey (Hülle um MainTiles.keydown, der
    // Launcher quittiert). Hier nur: ist es nicht mehr gültig (Fokus woanders, Dialog, Modul), vor
    // der Weitergabe schließen, damit nie eine Taste hinter dem sichtbaren Menü wirkt.
    if (tm.open && down && !tileMenuValid(mainTilesVm())) closeTileMenu('Startseite nicht mehr frei');
    if (dg.open && down && !denonGroupValid(mainTilesVm())) closeDenonGroup('Startseite nicht mehr frei');
    // Seite "Bilder" offen: gilt nur, solange "Alle Apps" vorne und frei ist (Risiko 4). Sonst
    // schließen und die Taste weitergeben (z. B. an eine per Cast gestartete App).
    if (gal.open) {
      if (!galleryValid()) {
        closeGallery('Alle Apps nicht mehr vorne');
        return;
      }
      if (down && SYS_KEYS[k] === 1) {
        closeGallery('Taste ' + k);
        return; // App-/Systemtaste: an den Launcher
      }
      // das OK, das die Seite eben geöffnet hat, nicht noch einmal auswerten (läuft der
      // Launcher-Handler vor diesem, z. B. nach einem Hot-Reload, kommt es hier nochmal an).
      // Gemerkt in gal.openKey statt am Event: Komponenten bekommen eine Kopie (Risiko 8).
      if (down && !(k === gal.openKey && Date.now() - gal.openedAt < 250)) galKey(k);
      if (!pass) swallow(e);
      return;
    }
    // OK auf dem Eintrag "Bilder" in "Alle Apps": hier synchron, bevor der Launcher die Taste
    // sieht (Risiko 5). Immer verschlucken, damit der Eintrag nie über startThirdPartyApp läuft;
    // die Seite öffnet aber nur, wenn galleryValid() (z. B. nicht, solange AppControl unter der
    // Startseite liegt, HOME aus einer App).
    if (down && k === 13 && galleryEntryFocused()) {
      if (!e.repeat) {
        if (galleryValid()) openGallery(13);
        else log('Seite Bilder nicht geöffnet (AppControl vorhanden)');
      }
      swallow(e);
      return;
    }
    // Bildschirmschoner: die erste Taste beendet ihn. Ob sie verschluckt wird, hängt daran, ob
    // UNSERE Oberfläche vorne ist (homeIdle: LauncherHis ist aktuelles Modul und Submodul, also
    // weder AppControl noch ein anderes App-Modul vorne), nicht an appFree(): liegt eine App nur
    // pausiert darunter (HOME aus einer App), ginge die Taste sonst an die unsichtbare Startseite
    // (OK startet die fokussierte Kachel, BACK holt die App zurück, Pfeile verschieben den Fokus
    // ungesehen). Die App selbst bekommt Tasten der Startseite ohnehin nie. HOME und App-Tasten
    // (SYS_KEYS) gehen weiter an den Launcher, HOME führt also wie ohne Mod zur App zurück.
    // appFree() entscheidet nur, ob DMP verlassen werden darf (Quelle/Player, Schutzregel 2).
    if (ss.state === 'off' || !down) return;
    var front = homeIdle();
    var eat = front && uiReadyNow() && !dialogUp() && !pass && SYS_KEYS[k] !== 1;
    stopScreensaver('Taste ' + k, front && appFree());
    if (eat) swallow(e);
  }
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);

  // ---- Bildschirmschoner ----
  // Phase 1: Kacheln, Statusleiste, Wetter blenden aus (Klasse flex-ss auf .launcher), nur das
  // Wallpaper bleibt. Phase 2: Quelle auf den Medien-Eingang (DMP), Bilder über den nativen
  // Foto-Player (Video-Ebene: schärfer als die 1920x1080-Oberfläche, im Test bestätigt);
  // sobald das erste Bild läuft, wird die Startseite durchsichtig (Klasse flex-ss-photo).
  // Bilder: /APPS/flexss/*.jpg, Liste flexss/list.json unter /var/local/applications/UI
  // (mods/screensaver/upload.py). Zufällige Reihenfolge, keine Wiederholung vor Ende der Runde.
  // dmp: wir haben auf DMP umgeschaltet und die Quelle noch nicht wieder verlassen;
  // held: Diashow zurückgehalten, weil eine App da ist oder DMP schon fremd aktiv ist (nur einmal
  // protokollieren)
  var ss = { state: 'off', t: 0, gen: 0, list: [], queue: [], last: '', current: '', fails: 0, photo: false,
    win: null, dmp: false, held: false };
  var idle = 0;
  // dmpOwn: die aktive DMP-Quelle stammt von unserem Umschalten. Gesetzt mit unserem Commit,
  // gelöscht im 1-s-Takt, sobald DMP nicht mehr aktiv ist (und kein Umschalten mehr aussteht).
  // Ist DMP schon aktiv, ohne dass wir es waren, gehört es jemand anderem (z. B. hiMedia/USB oder
  // DLNA, die selbst auf DMP schalten): dann keine Diashow (Risiko 3, Schutzregel 2). Bleibt
  // unser eigenes DMP stehen ("DMP bleibt"), darf die nächste Diashow es weiter benutzen.
  // Hot-Reload: von der alten Instanz übernehmen, sonst hielte sich die neue für fremd.
  var dmpOwn = false;
  try { dmpOwn = !!(prev && prev.ownsDmp && prev.ownsDmp()); } catch (e) { dmpOwn = false; }
  window.__flex.ownsDmp = function () { return dmpOwn; };

  // Verwaistes DMP: aktiv, nicht unseres, und JETZT benutzt es niemand. Typisch: unser Bildschirm-
  // schoner schaltete auf DMP, eine App startete vor dem Ausstieg ("DMP bleibt (Modul- oder
  // App-Wechsel)"), ssTick vergaß dmpOwn, und nach dem Ende der App kam DMP ohne uns zurück (LOG
  // 05.11.2026, 22:23-22:36). Niemand heißt: Startseite vorne und frei, kein Dialog, keine App und kein
  // App-Modul im Stapel (hiMedia, DLNA, Miracast ... schalten selbst auf DMP), kein Start/Ende, keine
  // eigene Benutzung (Schoner, Seite "Bilder", Freigabe, Ausstieg, kodiPlay) und der Medienplayer
  // spielt nichts Fremdes (läuft er, dann nur noch ein Foto unseres Schoners). Nur lesen; übernehmen
  // dürfen nur die Freigabe (bgCloseStart) und der Kodi-Start (startKodi), beide mit eigenem
  // DMP-Befehl auf eine Taste des Nutzers; kodiPlay selbst nie (kpGuard bleibt bei dmpForeign).
  // Der Bildschirmschoner nie (startSlideshow bleibt bei "DMP schon von anderer Seite aktiv").
  // Unlesbarer Player-Zustand = nicht verwaist (im Zweifel weniger).
  // Für das Log beim Übernehmen: Zustand des Medienplayers, nie die URL selbst (kann Token enthalten)
  function mpInfo() {
    var s = mpStat();
    if (!s) return 'Player unlesbar';
    return 'Player-Zustand ' + parseInt(s[2], 10) + ', URL ' + (String(s[1] || '').replace(/^\s+|\s+$/g, '') ? 'gesetzt' : 'leer');
  }

  function dmpOrphan() {
    if (dmpOwn || !dmpActive()) return false;
    if (!homeIdle() || !uiReadyNow() || dialogUp() || !noAppInStack()) return false;
    if (ss.state !== 'off' || ss.dmp || gal.open || bgc || dmpExit || kp.sid || kp.dmp || kp.foreign) return false;
    var s = mpStat();
    if (!s) return false;
    var url = String(s[1] || '').replace(/^\s+|\s+$/g, ''), st = parseInt(s[2], 10);
    // Leerlauf wie in kpPlay (0, 5, 6, 7, 9); URL nie ins Log (kann Token enthalten)
    if (url && [0, 5, 6, 7, 9].indexOf(st) < 0 && url.indexOf('file:///APPS/flexss/') !== 0) return false;
    return true;
  }

  // Freigabe der Hintergrund-Apps (bgRel) ebenso weitergeben, sonst lehnte kodiPlay nach einem
  // Hot-Reload wieder ab (E1) und der DMP-Ausstieg nach Kodi bliebe stehen. Nur eine noch gültige
  // (gleicher fx.hard der alten Instanz); fx.hard zählt in jeder Instanz neu ab 0. Eine laufende
  // Freigabe (bgc) hat stop() der alten Instanz schon ohne Folgen beendet.
  window.__flex.bgRelSnap = function () {
    var r = bgRel;
    if (!r || r.hard !== fx.hard || !(r.done || r.exit)) return null;
    return { rob: !!r.rob, robn: !!r.robn, ofn: !!r.ofn, done: !!r.done, exit: !!r.exit };
  };
  (function bgRelAdopt() {
    var r = null;
    try { r = prev && prev.bgRelSnap ? prev.bgRelSnap() : null; } catch (e) { r = null; }
    if (!r || typeof r !== 'object') return;
    bgRel = { rob: r.rob === true, robn: r.robn === true, ofn: r.ofn === true, hard: fx.hard,
      done: r.done === true, exit: r.exit === true };
    log('Freigabe der Hintergrund-Apps übernommen (' + (bgRel.done ? 'voll' : 'nur DMP-Ausstieg') + ')');
  })();

  function homeIdle() {
    try {
      return window.UI.getCurrentModuleId() === 'LauncherHis' &&
        window.UI.getCurrentSubModuleId() === 'LauncherHis' &&
        !!document.querySelector('.launcher') && !document.getElementById('flex-loading') && !gal.open;
    } catch (e) {
      return false;
    }
  }

  function setLauncherClass(name, on) {
    var el = document.querySelector('.launcher');
    if (!el) return;
    var c = ' ' + el.className + ' ';
    var has = c.indexOf(' ' + name + ' ') >= 0;
    if (on && !has) el.className = el.className + ' ' + name;
    if (!on && has) el.className = c.replace(' ' + name + ' ', ' ').replace(/^\s+|\s+$/g, '');
  }

  function applySsClasses() {
    setLauncherClass('flex-ss', ss.state !== 'off');
    setLauncherClass('flex-ss-photo', ss.photo);
  }

  // Verzögerte Schritte der Diashow (Player-Aufrufe): nur, solange dieselbe Diashow läuft (gen)
  // UND die Startseite vorne und frei von Apps ist -- beim Feuern neu geprüft (Schutzregeln 2/3).
  // Sonst endet der Schoner sofort, ohne Player oder Quelle anzufassen.
  function ssLater(gen, fn, ms) {
    later(function () {
      if (gen !== ss.gen) return;
      if (!homeIdle() || !appFree()) {
        stopScreensaver('Startseite nicht mehr frei', false);
        return;
      }
      fn();
    }, ms);
  }

  // VIDAAs eigener Bildschirmschoner (Art/ScreenArtmode) startet nach 10 min ohne Taste auf der
  // Startseite (localStorage "artScreen": 0 aus, 1 = 5, 2 = 10, 3 = 20 min; fehlt = 10 min).
  // flex.js fängt im eigenen Schoner die Tasten ab, sein Timer wird also nicht zurückgesetzt und
  // er übernimmt mitten in der Diashow (gesehen: 10 min nach der letzten Taste). Mit eigenem
  // Schoner darum aus. Rückgängig: localStorage.removeItem('artScreen') (siehe ROLLBACK.md).
  // Seine Bilder holt er (artInterface.js) nur, solange er an ist: alle 6 h über die VIDAA-
  // Inhalts-API (Seite "ScreenSaver") nach art/cache. Der Timer dafür ("resetScreendata") wird
  // zusätzlich gelöscht, falls er vor dem Abschalten schon lief.
  function vidaaArtOff() {
    var UI = window.UI;
    if (inst.artOff || !UI || !UI.store) return;
    inst.artOff = true;
    try { UI.clearGlobalTimer('resetScreendata'); } catch (e) { /* ignorieren */ }
    var v = null;
    try { v = localStorage.getItem('artScreen'); } catch (e) { /* ignorieren */ }
    if (v === '0') return;
    try {
      UI.store.commit('System/setArtScreenTimes', 0); // speichert "0" und löscht den Timer
    } catch (e) {
      try {
        localStorage.setItem('artScreen', '0');
        UI.clearGlobalTimer('setArtScreen');
      } catch (e2) { log('VIDAA-Bildschirmschoner nicht abschaltbar: ' + e2); return; }
    }
    log('VIDAA-Bildschirmschoner aus (war ' + (v === null ? 'Standard, 10 min' : v) + ')');
  }

  function ssTick() {
    if (!SCREENSAVER || !holdDone) return;
    vidaaArtOff();
    // unser DMP ist weg (LAST, App-Start); nicht, solange kodiPlay bzw. die Freigabe einer
    // Hintergrund-App (bgc) darauf umschaltet oder es hält, und nicht, solange ein DMP-Ausstieg
    // aussteht (dmpExit; nach einem Abbruch kann unser DMP-Befehl noch unterwegs sein)
    if (dmpOwn && !ss.dmp && !kp.dmp && !bgc && !dmpExit && !dmpActive()) dmpOwn = false;
    // Kodi läuft oder startet: kein Bildschirmschoner (der Launcher sieht dann keine Tasten); ein
    // laufender endet, ohne Quelle oder Player anzufassen
    if (kodiBusy) {
      idle = 0;
      if (ss.state !== 'off') stopScreensaver('Kodi läuft', false);
      return;
    }
    if (ss.state === 'off') {
      // Leerlauf zählt nur, solange die Startseite offen ist (in Apps sieht flex.js keine Tasten)
      if (!homeIdle()) { idle = 0; return; }
      if (++idle >= SCREENSAVER.idleSec) startScreensaver();
      return;
    }
    // Modul-Stapel geändert (z. B. App per Cast/DIAL/Sprache nach vorne): APM hat DMP dann schon
    // verlassen bzw. der Player gehört jetzt anderen -> Quelle nie umschalten (Risiko 1a)
    if (!homeIdle()) { stopScreensaver('Startseite nicht mehr aktiv', false); return; }
    // App taucht während der Diashow auf (z. B. Start im Hintergrund): Player nicht mehr anfassen
    if (ss.state === 'show' && !appFree()) { stopScreensaver('App vorhanden', false); return; }
    applySsClasses();
    if (ss.state === 'ui-off' && ++ss.t >= SCREENSAVER.wallpaperSec) startSlideshow();
  }

  function startScreensaver() {
    closeTileMenu('Bildschirmschoner');
    closeDenonGroup('Bildschirmschoner');
    ss.gen++;
    ss.state = 'ui-off';
    ss.t = 0;
    ss.photo = false;
    ss.fails = 0;
    ss.held = false;
    // ein noch offener DMP-Ausstieg wird beim nächsten Ende neu entschieden
    if (dmpExit) {
      ss.dmp = true;
      dmpExit = null;
    }
    applySsClasses();
    log('Bildschirmschoner: Oberfläche aus');
  }

  function readImageList() {
    var raw = null;
    try { raw = window.hisense.file.read('flexss/list.json', 1); } catch (e) { raw = null; }
    if (typeof raw !== 'string') return [];
    var arr;
    try { arr = JSON.parse(raw); } catch (e) { return []; }
    var ok = [];
    for (var i = 0; i < (arr || []).length; i++) {
      var p = String(arr[i]);
      // nur eigene Bilder: der Ordner der Liste wird beim Boot für alle beschreibbar
      if (/^\/APPS\/flexss\/[A-Za-z0-9._-]+\.(jpe?g|png)$/i.test(p)) ok.push(p);
    }
    return ok;
  }

  function nextImage() {
    if (!ss.queue.length) {
      ss.queue = ss.list.slice();
      for (var i = ss.queue.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var x = ss.queue[i];
        ss.queue[i] = ss.queue[j];
        ss.queue[j] = x;
      }
      // keine direkte Wiederholung über die Rundengrenze
      if (ss.queue.length > 1 && ss.queue[0] === ss.last) ss.queue.push(ss.queue.shift());
    }
    ss.last = ss.queue.shift();
    return ss.last;
  }

  function startSlideshow() {
    // Risiko 3 / Schutzregel 2: DMP ist für APM ein App-Start (Grund 4, Source.js:542, app.js
    // L8175) und ersetzt die aktuelle App. Liegt eine App unter der Startseite (HOME aus einer
    // App), startet oder endet gerade eine, bleibt es bei der reinen Wallpaper-Phase; der nächste
    // Tick prüft erneut. (Der originale Art-Schoner schaltet überhaupt keine Quelle um.)
    if (!appFree()) {
      if (!ss.held) {
        ss.held = true;
        log('Bildschirmschoner: App vorhanden, keine Diashow (nur Hintergrund)');
      }
      return;
    }
    // DMP schon aktiv, ohne dass wir umgeschaltet haben: gehört jemand anderem (siehe dmpOwn),
    // nicht übernehmen und später nicht per MpCtrl-Stopp/LAST beenden
    if (!dmpOwn && dmpActive()) {
      if (!ss.held) {
        ss.held = true;
        log('Bildschirmschoner: DMP schon von anderer Seite aktiv, keine Diashow (nur Hintergrund)');
      }
      return;
    }
    // nur die auf der Seite "Bilder" eingeschalteten
    ss.list = readImageList().filter(function (p) { return !isDisabled(baseName(p)); });
    if (!ss.list.length) {
      ss.state = 'wallpaper';
      log('Bildschirmschoner: keine Bilder (flexss/list.json bzw. alle abgeschaltet), bleibe beim Hintergrund');
      return;
    }
    ss.state = 'show';
    ss.queue = [];
    var gen = ss.gen, n = 0;
    log('Bildschirmschoner: Diashow mit ' + ss.list.length + ' Bildern');
    ss.dmp = true; // vor dem Umschalten: auch ein halber Wechsel wird beim Ende neu entschieden
    dmpOwn = true;
    try { window.UI.store.commit('Source/setCurrentSource', 'DMP'); } catch (e) { log('DMP-Fehler: ' + e); }
    (function waitDmp() {
      if (dmpActive()) {
        showImage(gen, false);
        return;
      }
      // ~6 s ohne bestätigtes DMP: Player nicht anfassen (im Zweifel weniger), nur Hintergrund
      if (++n > 20) {
        ss.state = 'wallpaper';
        log('Bildschirmschoner: DMP nicht bestätigt, bleibe beim Hintergrund');
        return;
      }
      ssLater(gen, waitDmp, 300);
    })();
  }

  // ---- Überblendung und Zoom ----
  // Der Player gibt beim nächsten Bild das alte frei und zeigt Schwarz, bis das neue (4K)
  // dekodiert ist (~1 s); seine eigenen Effekte starten von Schwarz. Darum blendet die Oberfläche
  // vor dem Wechsel die Full-HD-Kopie des aktuellen Bildes ein (static/flex/ss/<name>,
  // Verknüpfung auf /APPS/flexss/ui, von mods/screensaver/upload.py), der Player lädt darunter,
  // und eine Weile nach "läuft" blendet die Kopie aus. Am TV gesehen:
  // - Kopie sofort deckend und PlayMedia im selben Schritt: kurzes Flackern vor jeder
  //   Überblendung (der Player gibt frei, bevor die Oberfläche die Kopie gezeichnet hat).
  // - Kopie stattdessen einblenden: das Bild wird erst dunkler, dann wieder heller (halb
  //   durchsichtige Oberfläche über dem Video ergibt eine dunklere Mischung) -- sieht aus wie
  //   eine angetäuschte Überblendung. Voll deckend sieht die Kopie dagegen fast aus wie das Video.
  //   Darum: Kopie sofort deckend, COVER_HOLD_MS warten (sicher gezeichnet), dann PlayMedia.
  // - Die Kopie wirkt kälter als das Foto (Oberfläche ohne Farbverarbeitung des TVs): darum so
  //   kurz wie möglich zeigen; die Farbe gleicht mods/screensaver/upload.py (UI_TINT) an.
  // - "läuft" (Zustand 3) meldet der Player, bevor das Bild auf dem Schirm ist; Kopie 400 ms
  //   danach ausblenden ergab gelegentlich Schwarz, 1200 ms nie. Darum REVEAL_MS (1000).
  // Ohne Kopie: Effekt des Players.
  var COVER_HOLD_MS = 200;
  var COVER_FADE_MS = 1200;
  var REVEAL_MS = 1000;
  // Bildfenster des Players (setScreenPosition) in 4K-Koordinaten; größer als der Schirm = Zoom
  var UHD_W = 3840, UHD_H = 2160;
  var FULL_WIN = [0, 0, UHD_W, UHD_H];
  var cover = { url: '', ok: false, im: null };
  var kb = { timer: null, broken: false, measured: false };

  function coverUrl(p) {
    return 'static/flex/ss/' + p.substring(p.lastIndexOf('/') + 1);
  }

  // nur die Kopie des gerade gezeigten Bildes halten (dekodiert ~8 MB)
  function preloadCover(p) {
    var u = coverUrl(p);
    if (cover.url === u) return;
    cover = { url: u, ok: false, im: new Image() };
    var c = cover;
    c.im.onload = function () { c.ok = true; };
    c.im.src = u;
  }

  // Rahmen (1920x1080, schneidet ab) mit dem Bild darin; das Bild bekommt Lage und Größe des
  // Player-Fensters, damit die Kopie beim Zoom genau über dem Foto liegt
  function coverEl() {
    var el = document.getElementById('flex-ss-cover');
    if (!el) {
      el = document.createElement('div');
      el.id = 'flex-ss-cover';
      el.appendChild(document.createElement('div'));
      document.body.appendChild(el);
    }
    return el;
  }

  // Kopie des aktuellen Bildes in der Lage win sofort deckend zeigen; false = keine Kopie geladen
  function coverShow(p, win) {
    if (!p || cover.url !== coverUrl(p) || !cover.ok) return false;
    var el = coverEl(), img = el.firstChild, w = win || FULL_WIN, k = 1920 / UHD_W;
    el.style.transition = 'none';
    img.style.left = Math.round(w[0] * k) + 'px';
    img.style.top = Math.round(w[1] * k) + 'px';
    img.style.width = Math.round(w[2] * k) + 'px';
    img.style.height = Math.round(w[3] * k) + 'px';
    img.style.backgroundImage = 'url(' + cover.url + ')';
    el.style.opacity = '1';
    return true;
  }

  function uncover() {
    var el = document.getElementById('flex-ss-cover');
    if (!el) return;
    el.style.transition = 'opacity ' + (COVER_FADE_MS / 1000) + 's ease-in-out';
    el.style.opacity = '0';
  }

  function removeCover() {
    var el = document.getElementById('flex-ss-cover');
    if (el && el.parentNode) el.parentNode.removeChild(el);
    cover = { url: '', ok: false, im: null };
  }

  function setWindow(w) {
    try {
      window.modeljs.mpctrl.setScreenPosition([w[0], w[1], w[2], w[3], 1, 0]);
      ss.win = w;
      return true;
    } catch (e) {
      if (!kb.broken) log('Zoom aus, setScreenPosition-Fehler: ' + e);
      kb.broken = true;
      return false;
    }
  }

  // Ken Burns: f = 0..1 über die Standzeit; side 0 = Blick auf die linke, 1 = auf die rechte
  // Bildseite, wandert zur Mitte (0,5), während das Bild von zoom.from auf zoom.to wächst
  function kbWindow(f, side) {
    var z = SCREENSAVER.zoom;
    var sc = z.from + (z.to - z.from) * f;
    var p = side + (0.5 - side) * f;
    var w = Math.round(UHD_W * sc), h = Math.round(UHD_H * sc);
    return [Math.round((UHD_W - w) * p), Math.round((UHD_H - h) / 2), w, h];
  }

  // ein Intervall je Bild (nicht later(): bei ~15 Schritten/s würde inst.timers stetig wachsen)
  function kbStart(gen, side) {
    kbStop();
    var z = SCREENSAVER.zoom;
    if (!z || kb.broken) return;
    var t0 = Date.now(), dur = SCREENSAVER.slideSec * 1000 - REVEAL_MS, n = 0, spent = 0;
    kb.timer = setInterval(function () {
      if (inst.stopped || gen !== ss.gen) { kbStop(); return; }
      // setScreenPosition ist ein Player-Aufruf: nur ohne App (Schutzregel 2)
      if (!homeIdle() || !appFree()) { kbStop(); return; }
      var a = Date.now();
      var f = Math.min(1, (a - t0) / dur);
      if (!setWindow(kbWindow(f, side))) { kbStop(); return; }
      if (!kb.measured) {
        spent += Date.now() - a;
        if (++n === 50) {
          kb.measured = true;
          log('Zoom: setScreenPosition dauert im Schnitt ' + (spent / n).toFixed(1) + ' ms');
        }
      }
      if (f >= 1) kbStop();
    }, z.stepMs);
    inst.timers.push(kb.timer);
  }

  function kbStop() {
    if (kb.timer) clearInterval(kb.timer);
    kb.timer = null;
  }

  // Wechsel zum nächsten Bild: Zoom anhalten, Kopie in genau dieser Lage zeigen, dann laden
  function nextSlide(gen) {
    kbStop();
    if (coverShow(ss.current, ss.win)) {
      ssLater(gen, function () { showImage(gen, true); }, COVER_HOLD_MS);
    } else {
      showImage(gen, false);
    }
  }

  // Nur mit Debug, die ersten Wechsel je Start: jede Änderung von getMpCtrlStat im 50-ms-Takt
  // mitschreiben (6 s ab PlayMedia), um zu sehen, wann ein Bild wirklich angezeigt wird.
  // Eigene Timer statt ssLater(): inst.timers soll dafür nicht wachsen.
  var traceCount = 0;

  function traceStat(gen, mp) {
    if (!debug || traceCount >= 4) return;
    traceCount++;
    var t0 = Date.now(), last = '';
    (function step() {
      if (inst.stopped || gen !== ss.gen) return;
      var v = '';
      try { v = String(mp.getMpCtrlStat()).replace(/file:\/\/[^,]*/, '<url>'); } catch (e) { v = 'Fehler'; }
      if (v !== last) {
        last = v;
        log('Trace ' + traceCount + ' +' + (Date.now() - t0) + ' ms: ' + v);
      }
      if (Date.now() - t0 < 6000) setTimeout(step, 50);
    })();
  }

  // Bild an den Player geben; Zustand = drittes Feld von getMpCtrlStat (1 vorbereiten,
  // 2 vorbereitet, 3 läuft, 200 Fehler). Erst nach "vorbereitet" anzeigen (MpCtrl([1])); ein
  // "läuft" vom vorigen Bild zählt nicht. covered = Kopie liegt schon über dem Player.
  function showImage(gen, covered) {
    var mp = window.modeljs.mpctrl;
    // verdeckt (Kopie oder beim ersten Bild noch das Wallpaper): Player ohne eigenen Effekt
    try { mp.setAnimate(covered || !ss.photo ? 0 : SCREENSAVER.effect); } catch (e) { /* optional */ }
    var p = nextImage(), tries = 0, prepared = false, resends = 0;
    var zoom = !!SCREENSAVER.zoom && !kb.broken;
    traceStat(gen, mp);
    var side = Math.random() < 0.5 ? 0 : 1;
    function send() {
      try {
        mp.PlayMedia(['file://' + p, null, null, null, null, null, 16, null, null, null, 'Media']);
      } catch (e) { log('PlayMedia-Fehler: ' + e); }
    }
    send();
    (function poll() {
      var s = -1;
      try { s = parseInt(String(mp.getMpCtrlStat()).split(',')[2], 10); } catch (e) { /* weiter */ }
      // Player hängt noch im Freigeben (7), im Leerlauf oder zeigt nach ~2 s noch das alte Bild
      // (3; mit Zoom gesehen: Auftrag ignoriert): Auftrag erneut schicken
      if (!prepared && (s === 7 || s === 0 || s === 5 || s === 3) && tries > 0 && tries % 7 === 0 &&
          resends < 3) {
        resends++;
        log('Bild erneut an den Player (Zustand ' + s + '): ' + p);
        send();
      }
      if (!prepared && (s === 2 || s === 8)) {
        prepared = true;
        try { mp.MpCtrl([1]); } catch (e) { log('MpCtrl-Fehler: ' + e); }
      }
      if (prepared && s === 3) {
        ss.fails = 0;
        ss.current = p;
        // Startlage des Zooms setzen, solange Kopie bzw. Wallpaper noch darüber liegen
        if (zoom) setWindow(kbWindow(0, side));
        ssLater(gen, function () {
          if (!ss.photo) {
            ss.photo = true;
            applySsClasses(); // Wallpaper blendet ins erste Foto über
            log('Bildschirmschoner: erstes Bild sichtbar');
          }
          if (covered) uncover();
          if (zoom) kbStart(gen, side);
        }, REVEAL_MS);
        ssLater(gen, function () { preloadCover(p); }, REVEAL_MS + COVER_FADE_MS + 600);
        ssLater(gen, function () { nextSlide(gen); }, SCREENSAVER.slideSec * 1000);
        return;
      }
      if (s === 200 || ++tries > 33) { // ~10 s ohne Erfolg
        log('Bild übersprungen: ' + p + ' (Zustand ' + s + ')');
        if (++ss.fails >= ss.list.length) {
          log('Bildschirmschoner: kein Bild abspielbar, bleibe beim Hintergrund');
          kbStop();
          leaveDmp('kein Bild abspielbar');
          removeCover();
          ss.state = 'wallpaper';
          ss.photo = false;
          applySsClasses();
          return;
        }
        showImage(gen, covered); // Abdeckung (falls aktiv) bleibt, bis ein Bild läuft
        return;
      }
      ssLater(gen, poll, 300);
    })();
  }

  // Nur über leaveDmp() aufrufen: ein MpCtrl-Stopp ohne Prüfung trifft womöglich eine App.
  // Die Quelle (LAST) schaltet leaveDmp() selbst und nur nach lastIsPhysical().
  function stopPlayer() {
    kbStop();
    // Bildfenster zurück, sonst bleibt der Zoom für andere Wiedergaben eingestellt
    if (ss.win) {
      setWindow(FULL_WIN);
      ss.win = null;
    }
    try { window.modeljs.mpctrl.MpCtrl([3, -1, 0, 'Media']); } catch (e) { /* ignorieren */ }
  }

  // Wohin führt LAST? Source.js:507 (app.js L8175) gibt "LAST" an PubFunc SourceSwitchLAST weiter
  // (L8124, "PubFunc.js:8824/8833/8839/8849"), das GetLastSourceName() auswertet (am TV: JSON mit
  // sourceType "physical", name/id "HDMI1"):
  // - "physical", oder lesbar ohne sourceType: schaltet nur den Eingang CURRENT_SOURCE zurück;
  // - "virtualSource": startApp(..., startMethod 17) -> startet eine App;
  // - "ottChannel": startVidaaPlus -> startThirdPartyApp -> startet eine App;
  // - "ipChannel": tut nichts.
  // Eine App aus unserem Zeitgeber zu starten verletzt die Regel des Besitzers (Schutzregel 4); der
  // Launcher selbst lässt LAST beim OTT-Kanal aus (handleOttPlay, "PubFunc.js:8991"). Darum LAST
  // nur bei "physical"; unlesbar = im Zweifel kein LAST.
  function lastIsPhysical() {
    var o;
    try { o = window.modeljs.source.GetLastSourceName(); } catch (e) { return false; }
    if (!o || typeof o !== 'object') {
      try { o = JSON.parse(String(o)); } catch (e2) { return false; }
    }
    if (!o || typeof o !== 'object') return false;
    return !o.sourceType || o.sourceType === 'physical';
  }

  // ---- DMP-Quelle nach dem Bildschirmschoner wieder verlassen (Risiko 1, Schutzregeln 2 und 3) ----
  // setCurrentSource('LAST') ist genau der Befehl, mit dem EXIT eine App beendet (app.js L1265;
  // Source.js:507 "LAST" -> SourceSwitchLAST ohne Prüfung auf AppControl, L8175). Früher lief er
  // 1,6 s nach dem Ende des Schoners ohne jede Bedingung und beendete eine App, die in diesem
  // Fenster nach vorne kam (Cast, zweiter Tastendruck). Jetzt:
  // - Endet der Schoner, weil sich der Modul-Stapel geändert hat oder eine App da ist, wird gar
  //   nichts umgeschaltet (stopScreensaver(..., false)).
  // - Nach einer Taste auf der Startseite wird erst entschieden, wenn der Zeitgeber feuert, und
  //   nur, wenn seit dem Planen kein STR/INIT_LOADING kam (fx.hard), Modul-Stapel und App-Zustand
  //   gleich sind (launcherSig), seit 1,6 s keine Taste kam (fx.keys/lastKeyAt; sonst neu warten)
  //   und dann leaveDmp() noch zustimmt. ss.gen allein reicht nicht: stopScreensaver erhöht es selbst.
  // - LAST startet selbst eine App, wenn die letzte Quelle ein virtueller Eingang oder OTT-Kanal
  //   ist (SourceSwitchLAST): dann nur den Player stoppen, die Quelle bleibt (lastIsPhysical).
  // Bleibt DMP stehen (im Zweifel), schadet das keiner App: ein App-Start schaltet ohnehin um, und
  // BACK/EXIT auf der Startseite schalten selbst auf LAST (92.js L1938, L1939-1941).
  var SS_FADE_MS = 1600;       // Überblendung Foto -> Startseite (1,5 s, flex.css) + Reserve
  var DMP_EXIT_MAX_MS = 30000; // so lange höchstens auf Ruhe warten, danach bleibt DMP
  var dmpExit = null;

  // rel: '' (Bildschirmschoner, streng), 'kodi' (nach Kodis Ende) oder 'close' (nach unserer
  // Freigabe einer Hintergrund-App): bei 'kodi'/'close' zählen freigegebene Merker nicht (E1 b,
  // appFreeCore('exit')). Solange ein Ausstieg aussteht, gilt DMP weiter als unseres (ssTick).
  function scheduleDmpExit(reason, rel) {
    var p = { keys: fx.keys, hard: fx.hard, sig: launcherSig(), t0: Date.now(), reason: reason, rel: rel || '' };
    dmpExit = p;
    later(function () { dmpExitCheck(p); }, SS_FADE_MS);
  }

  function dmpExitCheck(p) {
    if (dmpExit !== p) return; // ersetzt oder verworfen
    var why = '';
    if (p.hard !== fx.hard) why = 'STR oder Neustart';
    else if (!p.sig || launcherSig() !== p.sig) why = 'Modul- oder App-Wechsel';
    else if (Date.now() - p.t0 > DMP_EXIT_MAX_MS) why = 'keine Ruhe';
    if (why) {
      dmpExit = null;
      if (why === 'keine Ruhe' && p.rel === 'close' && !dmpActive()) log('DMP-Ausstieg entfällt (' + p.reason + '): DMP wurde nicht aktiv');
      else log('DMP bleibt (' + why + ')');
      return;
    }
    // Taste seit dem Planen: alte Entscheidung ungültig, 1,6 s nach der letzten Taste neu prüfen
    var quiet = Date.now() - lastKeyAt;
    if (p.keys !== fx.keys || quiet < SS_FADE_MS) {
      p.keys = fx.keys;
      later(function () { dmpExitCheck(p); }, Math.max(100, SS_FADE_MS - quiet));
      return;
    }
    // nach unserer Freigabe kann unser DMP-Befehl noch unterwegs sein (Abbruch vor der Bestätigung,
    // Zeitlimit; am TV ~1,2 s, LOG2 306.676 -> 307.91): erst entscheiden, wenn DMP steht, höchstens
    // bis DMP_EXIT_MAX_MS. Sonst schaltete DMP nach dem Ausstieg noch um und bliebe stehen.
    if (p.rel === 'close' && !dmpActive()) {
      later(function () { dmpExitCheck(p); }, 500);
      return;
    }
    dmpExit = null;
    leaveDmp(p.reason, !!p.rel);
  }

  // Player stoppen und LAST nur, wenn JETZT alles frei von Apps ist und DMP noch unsere Quelle ist;
  // LAST zusätzlich nur, wenn es bloß einen physischen Eingang zurückschaltet (lastIsPhysical).
  // rel: nach Kodi bzw. nach unserer Freigabe zählen freigegebene Hintergrund-Merker nicht (E1 b,
  // bgExitCovered: auch, wenn die Freigabe nach unserem DMP-Befehl abgebrochen wurde)
  function leaveDmp(why, rel) {
    var home = false;
    try { home = window.UI.getCurrentModuleId() === 'LauncherHis'; } catch (e) { home = false; }
    if (!home || !appFree(rel === true ? 'exit' : false)) {
      log('DMP bleibt (' + why + '): Launcher nicht frei von Apps');
      return false;
    }
    if (!dmpActive()) {
      ss.dmp = false;
      log('DMP schon verlassen (' + why + ')');
      return false;
    }
    stopPlayer();
    ss.dmp = false;
    if (!lastIsPhysical()) {
      // Quelle bleibt DMP (dmpOwn bleibt gesetzt); BACK/EXIT auf der Startseite schalten über die
      // eigenen Wege des Launchers auf LAST (92.js L1938-1941), auf eine Taste des Nutzers hin
      log('DMP bleibt (' + why + '): letzte Quelle nicht physisch (virtuell/OTT/unlesbar), nur Player gestoppt');
      return true;
    }
    try { window.UI.store.commit('Source/setCurrentSource', 'LAST'); } catch (e) { /* ignorieren */ }
    log('DMP verlassen (' + why + ')');
    return true;
  }

  // leave: die DMP-Quelle darf (nach erneuter Prüfung beim Feuern) verlassen werden. false, wenn
  // der Schoner endet, weil sich der Modul-Stapel geändert hat, eine App da ist oder STR kommt:
  // dann hat APM DMP schon verlassen bzw. gehört der Player anderen -> Quelle und Player nie anfassen.
  // Das keyup der auslösenden Taste regelt onKey (swallow).
  function stopScreensaver(reason, leave) {
    var hadDmp = ss.dmp;
    ss.gen++;
    ss.state = 'off';
    ss.photo = false;
    ss.dmp = false;
    ss.held = false;
    idle = 0;
    kbStop();
    applySsClasses(); // Startseite blendet wieder ein
    removeCover();
    ss.current = '';
    if (hadDmp) {
      // Player erst stoppen, wenn das Wallpaper wieder deckt (Überblendung Foto -> Startseite, 1,5 s)
      if (leave) scheduleDmpExit(reason);
      else log('DMP bleibt (' + reason + '): Quelle und Player nicht angefasst');
    }
    log('Bildschirmschoner beendet (' + reason + ')');
  }

  // ---- Kodi-Wiedergabe über den TV-Player ("kodiPlay", Stufe 1 TVPlayer) ----
  // Kodi (root) legt einen signierten Auftrag in den Brückenordner (KP_DIR, Symlink auf tmpfs);
  // flex.js schaltet wie der Bildschirmschoner auf DMP und gibt die URL an den Medienplayer des TVs
  // (PlayMedia Typ 4 wie hiMedia/DLNA). Kodi steuert über ctl (Soll-Zustand: seq, Lebenszeichen hb),
  // flex.js meldet den Ist-Zustand in player.json (n steigt, ack = zuletzt umgesetztes seq).
  // Jede Datei: "<HMAC-SHA256 hex> <JSON>", HMAC über "<name>\n<JSON>" mit dem Laufschlüssel, den
  // root je Kodi-Lauf als rt/key ablegt und nach der Quittung löscht (D19; kein fester Schlüssel).
  // Quelle und Player nur nach kpCanTouch() (Schutzregel 2 ohne Kodi-Bedingung); verzögerte Schritte
  // prüfen beim Feuern neu (kpLater, Schutzregel 3). Solange Kodi läuft, bleibt DMP; LAST erst nach
  // Kodis Ende über scheduleDmpExit -> leaveDmp -> lastIsPhysical. Nie: eigene native Listener,
  // Tabellen-Iteratoren (create*, Schutzregel 1), setUIVisible, Bildeinstellungen, DRM.
  // Log: nur sid und Zustände, nie URL, Token oder Schlüssel.
  // Am TV gemessen (S1, 29.10.2026, docs/kodi/TVPLAYER-DESIGN.md Abschnitt 8): PlayMedia auf
  // 127.0.0.1 geht, Zustand 2 ist nach ~2,3 s im 250-ms-Takt sichtbar, Fortsetzen mit
  // MpCtrl([8,null,s]) und genaues Springen (SeekFlag 100) wirken, ein zweites PlayMedia wechselt
  // direkt, getMpCtrlStat liefert eine Komma-Zeichenkette (mpStat zerlegt sie).
  var KP_DIR = 'flexkodi/rt/';      // RAM über Symlink (P5 bestanden); Rückfall 'flexkodi/'
  var KP_POLL_MS = 250, KP_REQ_MAX_AGE_S = 3, KP_HB_MAX_TICKS = 60, KP_STATUS_MS = 5000;
  var KP_PREP_MAX_MS = 20000, KP_DMP_TRIES = 33, KP_MAX_RAW = 2048, KP_URL_MAX = 1024;
  var KP_PLAYTIME_MAX = 360000, KP_SEEK_SETTLE_MS = 3000, KP_RESUME_CHECK_MS = 4000, KP_EOF_SLACK_S = 10;
  var KP_AUD_FIRST_MS = 1500, KP_AUD_LAST_MS = 5000;  // [31] nach setAudioTrack bis 5 s abfragen (REV:180)
  var KP_NAME_RE = /^media(\.[a-z0-9]{1,5})?$/;
  var KP_ES_URL = 'es:';                 // Platzhalter: Auf dem ES-Weg geht keine URL an den TV-Player
  var KP_ES_SETTLE_MS = 2500;            // nach einem Stopp des TV-Players, bevor Kodis Helfer anfängt
  // Spulen wie hiMedia (OAPP:26821/26828). Nur, wenn ctl.speed es verlangt: Kodi schickt das nur mit
  // dem Schalter FLEX_KODI_TRICKPLAY=1 (D21 nicht bestätigt, S1/P2: 400 ergab nur ~1,3x), sonst
  // bleibt speed 100 und Kodi spult mit Sprüngen (seekN/seekTo, ±30 s je Druck).
  var KP_SPEEDS = [100, 200, 400, 800, 1600, 100200, 100400, 100800, 101600];

  var kp = { sid: '', url: '', es: 0, st: 'idle', why: '', err: 0, gen: 0, n: 0, out: 0, dmp: false, foreign: false,
    debug: false, timer: null, t0: 0, prepared: false, started: false, eof: false, resume: 0, dar: 0,
    ov: 0, fb: 0, exitPending: false, srcMiss: 0, dmpTries: 0, sess: '', lost: 0, mine: false,
    resends: 0, ctl: null, ctlRaw: '', seqIn: -1, hbIn: -1, ack: -1, hbTicks: 0, ap: null, playRaw: '',
    mp: -1, flags: 0, pos: 0, dur: 0, seekable: 0, seekTo: -1, seekAt: 0, resumeAt: 0, audAt: 0, audEnd: 0,
    acodec: '', aud: -1, spd: 100, win: null, outKey: '', outAt: 0, seen: [] };

  // ---- HMAC-SHA256 (ES5; gegen Node-crypto geprüft, flexjs-bridge.md 6.3; am TV P6: RFC 4231
  // Fall 2 richtig, 1,78 ms je HMAC über 300 Byte) ----
  var SHA_K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  // bytes: Array 0..255 (Nachrichten hier < 4 KB); Ergebnis: 32 Bytes
  function sha256(bytes) {
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var m = bytes.slice(), bits = bytes.length * 8, w = [], i, j, a, b, c, d, e, f, g, k, t1, t2;
    m.push(0x80);
    while (m.length % 64 !== 56) m.push(0);
    m.push(0, 0, 0, 0, (bits >>> 24) & 255, (bits >>> 16) & 255, (bits >>> 8) & 255, bits & 255);
    for (i = 0; i < m.length; i += 64) {
      for (j = 0; j < 16; j++) w[j] = (m[i + 4 * j] << 24) | (m[i + 4 * j + 1] << 16) | (m[i + 4 * j + 2] << 8) | m[i + 4 * j + 3];
      for (j = 16; j < 64; j++) {
        w[j] = (w[j - 16] + (rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3)) + w[j - 7] +
          (rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10))) | 0;
      }
      a = h[0]; b = h[1]; c = h[2]; d = h[3]; e = h[4]; f = h[5]; g = h[6]; k = h[7];
      for (j = 0; j < 64; j++) {
        t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[j] + w[j]) | 0;
        t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + k) | 0;
    }
    var out = [];
    for (i = 0; i < 8; i++) out.push((h[i] >>> 24) & 255, (h[i] >>> 16) & 255, (h[i] >>> 8) & 255, h[i] & 255);
    return out;
  }

  function asciiBytes(s) { var o = []; for (var i = 0; i < s.length; i++) o.push(s.charCodeAt(i) & 255); return o; }

  function hexOf(b) { var s = ''; for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16); return s; }

  function hexBytes(hx) { var o = []; for (var i = 0; i + 1 < hx.length; i += 2) o.push(parseInt(hx.substr(i, 2), 16)); return o; }

  function hmacHex(key, msg) {
    var k = key.length > 64 ? sha256(key) : key.slice(), ip = [], op = [], i;
    while (k.length < 64) k.push(0);
    for (i = 0; i < 64; i++) { ip.push(k[i] ^ 0x36); op.push(k[i] ^ 0x5c); }
    return hexOf(sha256(op.concat(sha256(ip.concat(asciiBytes(msg))))));
  }

  // Laufschlüssel: Bytes nur im Speicher. Hot-Reload: einmalige Übergabe von der alten Instanz.
  // kpKeyKid = derselbe Schlüssel als Hex, nur zum Vergleich mit rt/key im Speicher, nie loggen.
  var KP_KEYB = null, kpKeyKid = '';
  try { if (prev && prev.kpKeyOnce) KP_KEYB = prev.kpKeyOnce(); } catch (e) { KP_KEYB = null; }
  if (Object.prototype.toString.call(KP_KEYB) !== '[object Array]' || KP_KEYB.length !== 16) KP_KEYB = null;
  else kpKeyKid = hexOf(KP_KEYB);
  (function (self) {                // self = unser window.__flex, nicht das der nächsten Instanz
    self.kpKeyOnce = function () { var k = KP_KEYB; delete self.kpKeyOnce; return k; };
  })(window.__flex);

  // ---- Dateien der Brücke (nur die festen Namen, Rohtext-Vergleich vor der HMAC) ----
  function kpRead(name) {
    var raw = null;
    try { raw = window.hisense.file.read(KP_DIR + name, 1); } catch (e) { raw = null; }
    return typeof raw === 'string' ? raw : null;
  }

  function kpOpen(name, raw) {           // Rahmen, Zeichensatz, Signatur; null = verwerfen
    if (!KP_KEYB || !raw || raw.length > KP_MAX_RAW || !/^[0-9a-f]{64} \{[\x20-\x7e]*\}\s*$/.test(raw)) return null;
    var json = raw.substring(65).replace(/\s+$/, '');
    if (hmacHex(KP_KEYB, name + '\n' + json) !== raw.substring(0, 64)) return null;
    var o = null;
    try { o = JSON.parse(json); } catch (e) { return null; }
    return o && typeof o === 'object' && o.v === 1 ? o : null;
  }

  // hisense.file.write meldet Fehler über einen Rückgabewert ungleich 0 (P5: 0 = geschrieben); ob
  // als Zahl oder Text, ist nicht sicher -> beides auswerten
  function kpWriteOk(name, r, quiet) {
    var code = typeof r === 'number' ? r : parseInt(r, 10);
    if (!isNaN(code) && code !== 0) { if (!quiet) log('kodiPlay: ' + name + ' nicht schreibbar, Code ' + code); return false; }
    return true;
  }

  // player.json, tvack (je ein Aufruf, <= 400 Byte). true = geschrieben; false = Schreiben
  // fehlgeschlagen (Code ungleich 0 oder Ausnahme, ein neuer Versuch kann gelingen); null = nicht
  // versucht (kein Schlüssel, Zeichen außerhalb ASCII). quiet: Fehler nicht loggen (Wiederholung).
  function kpWriteFile(name, obj, quiet) {
    if (!KP_KEYB) return null;
    var json = JSON.stringify(obj);
    if (!/^[\x20-\x7e]*$/.test(json)) return null;
    try {
      return kpWriteOk(name, window.hisense.file.write(KP_DIR + name, hmacHex(KP_KEYB, name + '\n' + json) + ' ' + json + '\n', 1), quiet);
    } catch (e) { if (!quiet) log('kodiPlay: ' + name + ' nicht schreibbar: ' + e); return false; }
  }
  function kpWrite(obj) { return kpWriteFile('player.json', obj); }

  // Laufschlüssel (D19): einmal je Kodi-Lauf lesen, sobald Kodi bereit meldet; Quittung keyok
  // (root löscht rt/key danach, spätestens 10 s nach "bereit")
  function kpKeyLoad() {
    var raw = kpRead('key');
    if (!raw) return;                       // schon gelöscht (Quittung) oder Brücke aus
    raw = raw.replace(/\s+$/, '');
    if (!/^[0-9a-f]{32}$/.test(raw) || raw === kpKeyKid) return;
    KP_KEYB = hexBytes(raw);
    kpKeyKid = raw;
    // neuer Kodi-Lauf: tvkeys-Stand neu übernehmen; schon gesehene Rohtexte mit dem neuen Schlüssel
    // noch einmal prüfen (Kodis Anmeldung in tvkeys kann unverändert liegen)
    tvk.kid = ''; tvk.raw = ''; tvk.ackDue = false;
    if (!kp.sid) kp.playRaw = '';
    try { kpWriteOk('keyok', window.hisense.file.write(KP_DIR + 'keyok', hmacHex(KP_KEYB, 'keyok\n1'), 1)); }
    catch (e) { log('kodiPlay: keyok nicht schreibbar: ' + e); }
    log('kodiPlay: Laufschlüssel übernommen');
  }

  function kpSeen(sid) {
    for (var i = 0; i < kp.seen.length; i++) if (kp.seen[i] === sid) return true;
    kp.seen.push(sid);
    if (kp.seen.length > 20) kp.seen.shift();
    return false;
  }

  // URL aus port/tok/name (Abschnitt 3.3), Host fest, kein "?" (der Player wertet Query-Strings
  // aus, TA:47-49); '' = unzulässig
  function kpUrl(o) {
    if (o.port !== (o.port | 0) || o.port < 1024 || o.port > 65535) return '';
    if (typeof o.tok !== 'string' || !/^[0-9a-f]{32}$/.test(o.tok)) return '';
    if (typeof o.name !== 'string' || !KP_NAME_RE.test(o.name)) return '';   // Kodi schreibt klein (4.7)
    var url = 'http://127.0.0.1:' + o.port + '/' + o.tok + '/' + o.name;
    return url.length > KP_URL_MAX ? '' : url;
  }

  // Abschnitt 3.3; URL baut flex.js selbst. null = verwerfen (alt/ohne sid), {bad:true} = refused 'bad'
  function kpParsePlay(o) {
    if (!o || typeof o.sid !== 'string' || !/^[0-9a-f]{16}$/.test(o.sid)) return null;
    if (typeof o.t !== 'number' || Math.abs(Date.now() / 1000 - o.t) > KP_REQ_MAX_AGE_S) return null; // Kodi gab auf
    // ES-Weg (v8): Kodis Helfer spielt selbst mit echter Bildrate, flex.js stellt nur die Quelle DMP bereit
    if (o.es === 1) return { sid: o.sid, url: KP_ES_URL, es: 1, resume: 0, dar: 0, ov: 0, fb: 0 };
    var url = kpUrl(o);
    if (!url) return { bad: true, sid: o.sid };     // gültig signiert, aber Werte unzulässig
    return { sid: o.sid, url: url,
      resume: typeof o.resume === 'number' && o.resume >= 0 && o.resume <= KP_PLAYTIME_MAX ? Math.floor(o.resume) : 0,
      dar: typeof o.dar === 'number' && o.dar >= 0.5 && o.dar <= 4 ? o.dar : 0,
      ov: o.ov === 1 ? 1 : 0, fb: o.fb === 1 ? 1 : 0 };
  }

  // '' = annehmen, sonst why (FB:283-297). noKey: nur für kpDebug (Ablauf ohne Kodi-Dateien)
  function kpGuard(st, noKey) {
    if (!KP_KEYB && !noKey) return 'key';
    if (!st || !st.ready || !kodi.active) return 'kodi';
    if (!homeIdle() || !uiReadyNow()) return 'notHome';
    if (dialogUp()) return 'dialog';
    var sig = frontSig();
    if (!sig || (kodi.sig && sig !== kodi.sig)) return 'notHome';
    if (!appFreeCore(true)) return 'app';             // E1: pausiertes YouTube/Netflix, außer freigegeben (b)
    if (ss.state !== 'off' || gal.open) return 'busy';
    if (kp.foreign) return 'dmpForeign';              // bis Kodis Ende: Quelle/Player gehören anderen (REV:188-191)
    if (!dmpOwn && dmpActive()) return 'dmpForeign';  // gehört z. B. hiMedia/DLNA oder ist verwaist
    return '';
  }

  // Schutzregel 2 für Quelle und Player, ohne die Kodi-Bedingung; vom Nutzer freigegebene
  // Hintergrund-Apps (Kodi-Kachel, "App schließen") zählen nicht (E1 b, bgRel)
  function kpCanTouch() { return !kp.foreign && homeIdle() && uiReadyNow() && appFreeCore(true); }

  // Quelle/Player gehören jetzt anderen: bis Kodis Ende nichts mehr anfassen, DMP nicht mehr als unseres
  function kpForeign(why) {
    if (!kp.foreign) log('kodiPlay: Quelle/Player fremd (' + why + ')');
    kp.foreign = true;
    dmpOwn = false;
  }

  // Verzögerter Schritt, gebunden an Wiedergabe, STR-/Neustart-Zähler und Modul-Stapel (Schutzregel 3)
  function kpLater(fn, ms) {
    var tok = { gen: kp.gen, hard: fx.hard, sig: frontSig() };
    later(function () {
      if (tok.gen !== kp.gen || !kp.sid) return;
      if (tok.hard !== fx.hard || frontSig() !== tok.sig || !kpCanTouch() || dialogUp()) {
        kpEnd('Startseite nicht mehr frei', 'stopped', false, 'notHome');
        return;
      }
      fn();
    }, ms);
  }

  // getMpCtrlStat: am TV eine Komma-Zeichenkette "<sitzung>,<url>,<zustand>,<tempo>,<fähigkeiten>,
  // <flags>,<x>,Media,<fehler>" (S1); ein Array (wie im Launcher-Code) geht ebenso. Unsere URL
  // enthält kein Komma.
  function mpStat() {
    var r = null;
    try { r = window.modeljs.mpctrl.getMpCtrlStat([]); } catch (e) { return null; }
    if (typeof r === 'string') r = r.split(',');
    return r && r.length > 8 ? r : null;
  }

  function kpCheckRequest(st) {           // aus kodiTick (1 s)
    var raw = kpRead('play.json');
    if (!raw || raw === kp.playRaw) return;
    kp.playRaw = raw;
    var req = kpParsePlay(kpOpen('play.json', raw));
    if (!req) { log('kodiPlay: Auftrag verworfen (Signatur oder Alter)'); return; }
    if (req.sid === kp.sid || kpSeen(req.sid)) return;
    var why = req.bad ? 'bad' : kpGuard(st);           // gültig signiert, aber Werte unzulässig: sofort sagen
    if (why) {
      log('kodiPlay: Auftrag ' + req.sid + ' abgelehnt (' + why + ')');
      kpWrite({ v: 1, sid: req.sid, n: 1, ack: -1, st: 'refused', why: why, t: Date.now() });
      if (kp.sid) kp.outKey = '';      // läuft noch eine Wiedergabe: ihr player.json gleich neu schreiben
      return;
    }
    kpStart(req);
  }

  function kpStart(req) {
    kpFlushStop(); // Stopp des vorigen Films mit Fenster, falls noch ausstehend (kpEnd)
    // Nächste Folge, bevor das alte ctl fremd wurde: der Player wechselt mit dem neuen PlayMedia
    // direkt (S1/P2; so macht es auch hiMedia beim nächsten Video, TA:63), darum hier kein Stopp,
    // DMP bleibt. Ein Fenster der vorigen Folge bleibt gemerkt: kpEnd setzt es sonst nie zurück.
    var oldWin = null;
    if (kp.sid) { oldWin = kp.win; kpEnd('neuer Auftrag', 'stopped', false, 'superseded'); }
    kp.gen++;
    kp.sid = req.sid; kp.url = req.url; kp.es = req.es ? 1 : 0; kp.resume = req.resume; kp.dar = req.dar; kp.ov = req.ov; kp.fb = req.fb;
    kp.st = 'switching'; kp.why = ''; kp.err = 0; kp.n = 0; kp.out = 0; kp.t0 = Date.now();
    // kp.foreign bleibt: setzt es nur kpKodiGone zurück (kpGuard hat ihn schon geprüft)
    kp.prepared = false; kp.started = false; kp.eof = false; kp.resends = 0; kp.win = oldWin; kp.srcMiss = 0;
    kp.dmpTries = 0; kp.sess = ''; kp.lost = 0; kp.mine = false;
    kp.ctl = null; kp.ctlRaw = ''; kp.seqIn = -1; kp.hbIn = -1; kp.ack = -1; kp.hbTicks = 0;
    kp.ap = { pause: 0, seekN: 0, speed: 100, audio: -1, sub: -2 };
    kp.mp = -1; kp.flags = 0; kp.pos = req.resume; kp.dur = 0; kp.seekable = 0; kp.seekTo = -1;
    kp.resumeAt = 0; kp.audAt = 0; kp.audEnd = 0; kp.acodec = ''; kp.aud = -1; kp.spd = 100; kp.outKey = '';
    // kp.debug bleibt, wie kpDebug ihn gesetzt hat; kpEnd setzt ihn zurück
    kp.dmp = true;                       // vor dem Umschalten (wie ss.dmp)
    kp.exitPending = false;
    dmpOwn = true;
    if (kp.ov) setLauncherClass('flex-kp-video', true);   // D16: nur im Misch-Modus
    kpStatus(true);
    kp.timer = setInterval(function () {
      if (inst.stopped) return;
      try { kpTick(); } catch (e) { log('kodiPlay-Fehler: ' + e); }
    }, KP_POLL_MS);
    inst.timers.push(kp.timer);
    log('kodiPlay: Auftrag ' + kp.sid + ' angenommen' + (kp.resume ? ', ab ' + kp.resume + ' s' : '') +
      (kp.debug ? ' (Debug)' : ''));
    if (dmpActive()) { kpPlay(); return; } // unser DMP steht noch (kpGuard: dmpOwn)
    try { window.UI.store.commit('Source/setCurrentSource', 'DMP'); } catch (e) { log('DMP-Fehler: ' + e); }
    kpWaitDmp();
  }

  // Auf DMP warten, höchstens KP_DMP_TRIES x 300 ms. Der Zähler steht in kp: eine per Hot-Reload
  // geladene Instanz übernimmt ihn über kpSnap und wartet weiter (kpAdopt).
  function kpWaitDmp() {
    if (!kp.sid || kp.st !== 'switching') return;
    if (dmpActive()) { kpPlay(); return; }
    if (++kp.dmpTries > KP_DMP_TRIES) { kpEnd('DMP nicht bestätigt', 'error', false, 'dmpTimeout'); return; }
    kpLater(kpWaitDmp, 300);
  }

  function kpPlay() {
    if (!kp.sid) return;
    if (!kpCanTouch() || !dmpActive()) { kpEnd('DMP nicht frei', 'stopped', false, 'notHome'); return; }
    if (kp.es) {
      // Der Medienplayer muss frei sein: Ein laufendes Medium belegt den Dienst für Kodis Helfer. Gestoppt wird nur,
      // was läuft, und dann mit Pause: Der Stopp wirkt verzögert und traf am TV sonst das eben angelegte Item
      // (05.11.2026: erstes Video ohne Bild)
      var s0 = mpStat(), st0 = s0 ? parseInt(s0[2], 10) : 0;
      var busy = !!s0 && String(s0[1] || '').replace(/^\s+|\s+$/g, '') !== '' && [0, 5, 6, 7, 9].indexOf(st0) < 0;
      if (busy) {
        try { window.modeljs.mpctrl.MpCtrl([3, -1, 0, 'Media']); } catch (e0) { log('kodiPlay: MpCtrl-Fehler: ' + e0); }
        log('kodiPlay: Medienplayer belegt (Zustand ' + st0 + '), gestoppt');
      }
      kpLater(function () {
        kp.st = 'esready';
        kpStatus(true);
        log('kodiPlay: Quelle bereit, Kodis Helfer spielt');
      }, busy ? KP_ES_SETTLE_MS : 0);
      return;
    }
    kp.st = 'preparing';
    kp.t0 = Date.now();
    try { window.modeljs.mpctrl.PlayMedia([kp.url, null, null, null, null, null, 4, null, null, null, 'Media']); }
    catch (e) { log('PlayMedia-Fehler: ' + e); kpEnd('PlayMedia-Fehler', 'error', true, 'player'); return; }
    kpStatus(true);
  }

  function kpTick() {                     // 250 ms
    if (!kp.sid) return;
    kp.n++;
    if (!kp.debug) {
      var raw = kpRead('ctl');
      if (raw !== null && raw !== kp.ctlRaw) {
        kp.ctlRaw = raw;
        var c = kpOpen('ctl', raw);
        // D12: ein gültiges ctl mit fremder sid beendet die laufende Wiedergabe sofort
        if (c && c.sid !== kp.sid) { kpEnd('Kodi: andere Wiedergabe', 'stopped', true, 'superseded'); return; }
        if (c && c.seq === (c.seq | 0) && c.seq >= kp.seqIn && c.hb === (c.hb | 0) && c.hb > kp.hbIn) {
          kp.seqIn = c.seq; kp.hbIn = c.hb; kp.ctl = c; kp.hbTicks = 0;
        }
      }
      if (++kp.hbTicks > KP_HB_MAX_TICKS) { kpEnd('Kodi antwortet nicht', 'error', true, 'kodiGone'); return; }
    }
    if (kp.ctl && kp.ctl.stop === 1) { kpEnd('Kodi: Stopp', 'stopped', true, ''); return; }
    if (kp.ov && kp.n % 4 === 0) setLauncherClass('flex-kp-video', true); // Startseite neu aufgebaut?
    if (kp.st !== 'switching') {
      if (kp.n % 4 === 0) {               // Quelle weg erst nach zwei Prüfungen hintereinander (REV:189-192)
        kp.srcMiss = dmpActive() ? 0 : kp.srcMiss + 1;
        if (kp.srcMiss >= 2) { kpForeign('Quelle weg'); kpEnd('Quelle DMP weg', 'stopped', false, 'sourceOut'); return; }
      }
      if (kp.es) {                        // kein TV-Player zu beobachten: nur Quelle und Lebenszeichen
        if (kp.ctl) kp.ack = kp.ctl.seq;
        kpStatus(false);
        return;
      }
      kpPoll();
      if (!kp.sid) return;
      if (kp.mine) kpApply();             // nicht auf eine Meldung hin, die nicht unsere ist (kpLost)
      if (!kp.sid) return;
    }
    kpStatus(false);
  }

  function kpFatal(s) {                   // wie hiMedia/DLNA (TA:126-145), dazu Netz/Datei
    return s === 200 || (s >= 1202 && s <= 1208) || s === 1301 || s === 1302 || s === 1307 ||
      (s >= 1401 && s <= 1404) || s === 1501 || s === 1502 || (s >= 1504 && s <= 1506) || s === 1601;
  }
  function kpWarn(s) { return (s >= 1303 && s <= 1306) || s === 1308 || s === 1309 || s === 1503; } // P11

  function kpPoll() {
    var mp = window.modeljs.mpctrl, s = mpStat(), now = Date.now();
    kp.mine = false;                     // kpApply nur, wenn diese Meldung unsere Wiedergabe betrifft
    if (!s) return;
    var u = String(s[1] === undefined || s[1] === null ? '' : s[1]).replace(/^\s+|\s+$/g, '');
    if (u !== kp.url) {
      if (kp.prepared) { kpLost(s, u); return; }
      // Schutzregel 2/3: auch die Quelle beim Senden neu prüfen (sie kann ohne Modulwechsel wechseln, CEC)
      if (kp.resends < 1 && now - kp.t0 > 3000 && kpCanTouch() && dmpActive()) {
        kp.resends++;
        log('kodiPlay: Auftrag erneut an den Player (Zustand ' + s[2] + ')');
        try { mp.PlayMedia([kp.url, null, null, null, null, null, 4, null, null, null, 'Media']); } catch (e) { /* weiter */ }
      }
      if (now - kp.t0 > KP_PREP_MAX_MS) kpEnd('Player antwortet nicht', 'error', true, 'prepTimeout');
      return;
    }
    kp.mine = true; kp.lost = 0; kp.sess = String(s[0]);
    var state = parseInt(s[2], 10), flags = parseInt(s[5], 10) || 0;
    kp.flags = flags;
    kp.seekable = 1 & (parseInt(s[4], 10) || 0);
    if (flags === 4) kp.eof = true;      // kommt am Dateiende vor Zustand 6 (RD:362)
    if (state !== kp.mp) { log('kodiPlay: Player-Zustand ' + state + ' (Flags ' + flags + ')'); kp.mp = state; }
    if (!kp.prepared && state === 2) {    // D8: nur 2 wie hiMedia/DLNA (TA:43-44); 8 nur im Log oben
      kp.prepared = true;
      // erstes Fenster und MpCtrl: Startseite frei UND DMP noch die aktuelle Quelle (Schutzregel 2)
      if (!kpCanTouch() || !dmpActive()) { kpEnd('Startseite oder DMP nicht mehr frei', 'stopped', false, 'notHome'); return; }
      try { kp.dur = parseInt(mp.getMpCtrlPlaytimeTotal(), 10) || 0; } catch (e) { kp.dur = 0; }
      kpWindow();
      kpStartPlayback();
      return;
    }
    if (state === 3 || state === 4 || state === 23 || state === 24 || state === 2009) {
      if (state === 3 || state === 4) kp.started = true;
      if (kp.started) kp.st = state === 4 ? 'paused' : ((flags & 1) || state === 23 ? 'buffering' : 'playing');
      if (!kp.dur) { try { kp.dur = parseInt(mp.getMpCtrlPlaytimeTotal(), 10) || 0; } catch (e) { /* weiter */ } }
      if (kp.n % 4 === 0 || kp.seekTo >= 0 || kp.spd !== 100 || state === 2009 || (flags & 8)) {
        try { kp.pos = parseInt(mp.getMpCtrlPlaytimeCurrent(), 10) || kp.pos; } catch (e) { /* weiter */ }
      }
      if (kp.spd >= 100100 && kp.pos <= 1) kp.spd = 100;  // TV springt bei 0/1 auf normal (TA:224)
      if (kp.seekTo >= 0 && (Math.abs(kp.pos - kp.seekTo) <= 2 || state === 2009 || (flags & 8) ||
          now - kp.seekAt > KP_SEEK_SETTLE_MS)) kp.seekTo = -1;
      if (kp.resumeAt && now > kp.resumeAt) {   // MpCtrl([8,..]) nicht gewirkt (P2): genau springen
        kp.resumeAt = 0;                         // Schutzregel 3: beim Feuern neu prüfen (REV:185)
        if (kp.seekable && kp.pos < kp.resume - 10 && kpCanTouch() && dmpActive()) {
          log('kodiPlay: Fortsetzen nicht gewirkt, Sprung auf ' + kp.resume + ' s');
          try { kpSeek(kp.resume, 100); } catch (e) { log('kodiPlay: Sprung-Fehler: ' + e); }
        }
      }
      if (kp.audAt && now > kp.audAt) {          // D10: [31] bis 5 s nach dem Wechsel abfragen
        // kp.acodec = Wert vor dem Wechsel (kpApply): erst eine Änderung oder die 5 s zählen
        var ac = kpAcodec(mp);
        if ((ac && ac !== kp.acodec) || now > kp.audEnd) { kp.acodec = ac; kp.audAt = 0; }
        else kp.audAt = now + 500;
      }
      return;
    }
    // Ende erst nach "vorbereitet" werten (wie hiMedia, TA 2.2: Zustand 6 nur, falls schon
    // vorbereitet): beim direkten Wechsel (kpStart) kann vorher noch das Freigeben des vorigen
    // Mediums gemeldet werden; sonst greift das Zeitlimit unten
    if ((state === 6 || state === 9) && kp.prepared) {
      var atEnd = kp.eof || (kp.dur > 0 && kp.pos >= kp.dur - KP_EOF_SLACK_S);  // D11
      kpEnd(atEnd ? 'Filmende' : 'Player vorzeitig beendet', atEnd ? 'ended' : 'stopped', true, atEnd ? '' : 'early');
      return;
    }
    if (kpFatal(state)) {
      kp.err = parseInt(s[8], 10) || state;
      kpEnd('Player-Fehler ' + kp.err, 'error', true, 'player');
      return;
    }
    if (kpWarn(state)) kp.err = state;  // melden, weiterspielen (Verhalten offen, P11)
    if (state === 5 && kp.started) { kpEnd('Player gestoppt', 'stopped', false, 'early'); return; }
    if (!kp.prepared && now - kp.t0 > KP_PREP_MAX_MS) kpEnd('nicht vorbereitet', 'error', true, 'prepTimeout');
  }

  // Nach "vorbereitet" betrifft die letzte Meldung nicht unsere URL ([1] = Medium der jeweils letzten
  // Meldung, TA:96; flex.js sieht nur den letzten Stand alle 250 ms). Übernommen (Quelle/Player bis
  // Kodis Ende fremd) nur mit Beleg: eine fremde URL, oder bei leerer URL eine neue Sitzungsnummer
  // [0] (jedes PlayMedia zählt sie hoch, RD:364; unseres liegt vor "vorbereitet"). Eine URL in
  // unserem Token-Pfad (z. B. media.srt dieser Wiedergabe, 4.7) gehört zu uns. Gewertet wird erst
  // die zweite solche Meldung hintereinander, ein Momentwert beendet nichts. Leere URL in unserer
  // Sitzung mit Zustand 0/5/6/7/9 = unser Medium ist freigegeben: Ende nach D11, Quelle bleibt unsere.
  function kpLost(s, u) {
    var base = kp.url.substring(0, kp.url.lastIndexOf('/') + 1), state = parseInt(s[2], 10);
    if (u && u.indexOf(base) === 0) { kp.mine = true; kp.lost = 0; return; }
    var other = u !== '' || (kp.sess !== '' && String(s[0]) !== kp.sess);
    // für den S3-Test am TV: Ablauf am Filmende bzw. bei Übernahme (nie die URL loggen)
    if (++kp.lost === 1) log('kodiPlay: Meldung nicht zu unserer URL (Sitzung ' + kp.sess + ' -> ' + s[0] +
      ', Zustand ' + state + ', URL ' + (u ? 'fremd' : 'leer') + ')');
    if (kp.lost < 2) return;
    if (other) { kpForeign('Player übernommen'); kpEnd('Player übernommen', 'stopped', false, 'taken'); return; }
    if (state === 0 || state === 5 || state === 6 || state === 7 || state === 9) {
      var atEnd = kp.eof || (kp.dur > 0 && kp.pos >= kp.dur - KP_EOF_SLACK_S);  // D11
      kpEnd(atEnd ? 'Filmende (Player freigegeben)' : 'Player vorzeitig freigegeben', atEnd ? 'ended' : 'stopped',
        state !== 5, atEnd ? '' : 'early');
    }
    // sonst (z. B. Zustand 3 ohne URL): weiter beobachten, den Player nicht anfassen
  }

  function kpWindow() {                   // D7, wie hiMedia setScreenSize(0) mit DAR (TA:345-361)
    var r = kp.dar, full = UHD_W / UHD_H, win = null;
    if (!r) {
      try {
        var md = window.modeljs.mpctrl.getMetadata([]);
        var mw = parseInt(md[26], 10) || 0, mh = parseInt(md[27], 10) || 0;
        if (mw > 0 && mh > 0) r = mw / mh;
      } catch (e) { r = 0; }
    }
    if (r > 0 && Math.abs(r - full) > 0.01) {
      if (r > full) { var h = Math.round(UHD_W / r); win = [0, Math.round((UHD_H - h) / 2), UHD_W, h]; }
      else { var w = Math.round(UHD_H * r); win = [Math.round((UHD_W - w) / 2), 0, w, UHD_H]; }
    }
    var p = win || FULL_WIN;
    try { window.modeljs.mpctrl.setScreenPosition([p[0], p[1], p[2], p[3], 1, 0]); kp.win = win; }
    catch (e) { log('kodiPlay: setScreenPosition-Fehler: ' + e); return; }
    log('kodiPlay: Fenster ' + (win ? win.join('x') : 'voll') + (r ? ' (DAR ' + r.toFixed(3) + ')' : ''));
  }

  function kpStartPlayback() {           // D8: Fortsetzen statt MpCtrl([1]) wie hiMedia (TA:43-45)
    var mp = window.modeljs.mpctrl;
    if (kp.resume > 0 && !kp.seekable && kp.fb) {  // 4.4: Kodi spielt selbst ab dem Fortsetzpunkt
      kpEnd('nicht spulbar, Kodi spielt selbst', 'refused', true, 'noResume');
      return;
    }
    try {
      if (kp.resume > 0 && kp.seekable && (!kp.dur || kp.resume < kp.dur - 5)) {
        mp.MpCtrl([8, null, kp.resume]);
        kp.pos = kp.resume;
        kp.resumeAt = Date.now() + KP_RESUME_CHECK_MS;
        log('kodiPlay: Start ab ' + kp.resume + ' s (Dauer ' + kp.dur + ' s)');
      } else {
        if (kp.resume > 0) kp.why = 'noResume'; // 4K (fb:0): ab 0, Kodi schützt den alten Fortsetzpunkt
        kp.pos = 0;
        mp.MpCtrl([1]);
        log('kodiPlay: Start von vorn (Dauer ' + kp.dur + ' s' + (kp.resume > 0 ? ', Fortsetzen nicht möglich' : '') + ')');
      }
    } catch (e) { log('kodiPlay: MpCtrl-Fehler: ' + e); }
  }

  function kpSeek(to, acc) {             // wie hiMedia un()/dn() (TA:199-205); S1/P2: 100 = genau
    var mp = window.modeljs.mpctrl;
    if (kp.spd !== 100) { mp.setMpctrlFlag([100]); kp.spd = 100; } // wie hiMedia vor dn() (OAPP:27095)
    mp.setMpCtrlSeekFlag(acc === 100 ? 100 : 0);
    mp.setMpCtrlPlaytimeCurrent(to);
    kp.pos = to; kp.seekTo = to; kp.seekAt = Date.now();
  }

  // getMetadata()[31] (Tonformat der laufenden Spur), bereinigt wie in player.json (3.5); '' = unlesbar
  function kpAcodec(mp) {
    try { return String(mp.getMetadata([])[31] || '').replace(/[^A-Za-z0-9 ._+-]/g, '_').substring(0, 32); }
    catch (e) { return ''; }
  }

  // Untertitel-Aussehen nach jeder Auswahl wie hiMedia (TA:281, Werte = Launcher-Standard TA:542-546)
  function kpSubStyle(mp) {
    mp.setMusicSubtitlePosition([10, 630, 1900, 400, 0, 0]);
    mp.setMpCtrlSubtitleTextSize([48]);
    mp.setMpCtrlSubtitleEncode([100]);
    mp.setSubtitleColor([255, 255, 255, 255]);
    mp.setSubtitleBGColor([0, 255, 255, 255]);
  }

  function kpApply() {                    // nur Unterschiede zu kp.ap; ack erst, wenn alles gesetzt ist
    var c = kp.ctl, ap = kp.ap, mp = window.modeljs.mpctrl;
    if (!c || !kp.started || !kpCanTouch() || !dmpActive()) return;
    try {
      if ((c.pause === 0 || c.pause === 1) && c.pause !== ap.pause) {
        if (kp.spd !== 100) { mp.setMpctrlFlag([100]); kp.spd = 100; }   // wie hiMedia (OAPP:26809-26816)
        mp.MpCtrl([c.pause ? 2 : 1]); ap.pause = c.pause;
      }
      if (KP_SPEEDS.indexOf(c.speed) >= 0 && c.speed !== ap.speed && !c.pause && kp.seekTo < 0) {
        ap.speed = c.speed;                  // D21 (nur mit FLEX_KODI_TRICKPLAY); nur spulbar (OAPP:26819)
        if (kp.seekable && c.speed !== kp.spd) { mp.setMpctrlFlag([c.speed]); kp.spd = c.speed; log('kodiPlay: Tempo ' + c.speed); }
      }
      if (c.seekN === (c.seekN | 0) && c.seekN !== ap.seekN && kp.seekTo < 0) { // ein Sprung nach dem anderen
        ap.seekN = c.seekN;
        var to = Math.floor(Number(c.seekTo) || 0);
        if (kp.seekable && to >= 0 && to <= KP_PLAYTIME_MAX) {
          if (kp.dur > 1 && to > kp.dur - 1) to = kp.dur - 1;
          kpSeek(to, c.seekAcc);
        } else kp.why = 'noSeek';
      }
      if (c.audio === (c.audio | 0) && c.audio >= 0 && c.audio < 64 && c.audio !== ap.audio) {
        // D10: Ausgangswert von [31] vor dem Wechsel; kpPoll wartet auf eine Änderung (oder 5 s), damit
        // ein langsamer Wechsel nicht mit dem Tonformat der vorigen Spur quittiert wird
        kp.acodec = kpAcodec(mp);
        mp.setAudioTrack(c.audio); ap.audio = c.audio; kp.aud = c.audio;
        kp.audAt = Date.now() + KP_AUD_FIRST_MS; kp.audEnd = Date.now() + KP_AUD_LAST_MS;
      }
      if (c.sub === (c.sub | 0) && c.sub >= -1 && c.sub < 64 && c.sub !== ap.sub) {
        mp.setMpCtrlSubtitleNo(c.sub); ap.sub = c.sub;
        if (c.sub >= 0) kpSubStyle(mp);      // REV:141
      }
    } catch (e) { log('kodiPlay: Befehl fehlgeschlagen: ' + e); }
    if (kp.seekTo < 0 && c.seekN === ap.seekN && !kp.audAt) kp.ack = c.seq;
  }

  // player.json bei Änderung, sonst alle 5 s (Kodi rechnet die Position dazwischen selbst weiter)
  function kpStatus(force) {
    if (!kp.sid) return;
    var win = kp.win ? kp.win.join('x') : '';
    var key = [kp.ack, kp.st, kp.why, kp.mp, kp.flags, kp.dur, kp.seekable, kp.err, kp.eof ? 1 : 0,
      kp.acodec, kp.aud, kp.spd, win].join('|');
    var now = Date.now();
    if (!force && key === kp.outKey && now - kp.outAt < KP_STATUS_MS) return;
    kp.out++;
    if (kp.debug) { kp.outKey = key; kp.outAt = now; return; } // Testhilfe ohne Datei
    if (kpWrite({ v: 1, sid: kp.sid, n: kp.out, ack: kp.ack, st: kp.st, why: kp.why, mp: kp.mp, flags: kp.flags,
      err: kp.err, pos: kp.pos, dur: kp.dur, seek: kp.seekable, eof: kp.eof ? 1 : 0, acodec: kp.acodec,
      aud: kp.aud, spd: kp.spd, win: win, t: now })) { kp.outKey = key; kp.outAt = now; }
  }

  // Wiedergabe beenden; stopPlayer nur, wenn jetzt alles frei und DMP unseres ist. Quelle bleibt DMP.
  // Reihenfolge wie stopPlayer(): erst das Fenster zurück, dann stoppen. Der Stopp wirkt verzögert;
  // ein setScreenPosition danach traf am 17.11.2026 den Player im Abbau (tvmain-Absturz in
  // Mm_SetDisplayRectangle -> g_object_set, Thread maJobHandler, DVD 1,37:1 mit Fenster).
  // 18.11.2026: Mit eigenem Fenster erst das Fenster zurück (17.11., Absturz im Player-Abbau), den Stopp aber erst
  // KP_WIN_STOP_MS später: Fensterwechsel und Stopp direkt hintereinander (dazu Kodi beim Minimieren ausgeblendet) ließen
  // Mm_Stop am 18.11. rund 100 s hängen; der TV blieb so lange auf DMP (kein HDMI-Bild, Film verzogen sichtbar). Ein neuer
  // Auftrag holt einen ausstehenden Stopp sofort nach (kpStart -> kpFlushStop), wie vorher ohne Pause.
  var KP_WIN_STOP_MS = 400;
  var kpPendingStop = null;
  function kpFlushStop() {
    var f = kpPendingStop;
    kpPendingStop = null;
    if (f) f();
  }

  function kpEnd(why, st, stopPlayer, code) {
    if (!kp.sid) return;
    if (stopPlayer) {
      if (kpCanTouch() && dmpOwn && dmpActive()) {
        if (kp.win) {
          try { window.modeljs.mpctrl.setScreenPosition([0, 0, UHD_W, UHD_H, 1, 0]); } catch (e2) { /* ignorieren */ }
          var url = kp.url;
          kpPendingStop = function () {
            // spielt inzwischen etwas anderes (fremdes PlayMedia), nicht anfassen; unlesbar oder leer: stoppen wie bisher
            var cur = '';
            var ms = mpStat();
            if (ms) cur = String(ms[1] || '').replace(/^\s+|\s+$/g, '');
            if (url && cur && cur !== url) { log('kodiPlay: verzögerter Stopp entfällt (anderes Medium)'); return; }
            try { window.modeljs.mpctrl.MpCtrl([3, -1, 0, 'Media']); } catch (e) { /* ignorieren */ }
          };
          later(kpFlushStop, KP_WIN_STOP_MS);
        } else {
          try { window.modeljs.mpctrl.MpCtrl([3, -1, 0, 'Media']); } catch (e) { /* ignorieren */ }
        }
      } else log('kodiPlay: Player nicht angefasst (' + why + ')');
    }
    kp.st = st;
    if (code) kp.why = code;
    kpStatus(true);
    log('kodiPlay: Ende ' + kp.sid + ' (' + why + ')');
    if (kp.timer) clearInterval(kp.timer);
    kp.timer = null;
    kp.gen++;
    kp.sid = ''; kp.url = ''; kp.ctl = null; kp.win = null; kp.debug = false; kp.seekTo = -1; kp.spd = 100;
    kp.resumeAt = 0; kp.audAt = 0;
    setLauncherClass('flex-kp-video', false);
  }

  // Kodi ist weg: Wiedergabe beenden; DMP nur über den bewährten Weg verlassen (FB:1026-1037).
  // leave = running fehlt wirklich (kodiTick); sonst bleibt DMP (D18, REV:41)
  function kpKodiGone(why, leave) {
    var foreign = kp.foreign;
    if (kp.sid) kpEnd('Kodi weg: ' + why, 'stopped', !foreign, 'kodiGone');
    setLauncherClass('flex-kp-video', false);
    if (kp.dmp) {
      kp.dmp = false;
      if (foreign || !dmpOwn) log('DMP bleibt (' + why + '): Quelle und Player nicht angefasst');
      else if (!leave) log('DMP bleibt (' + why + '): Kodis Ende nicht sicher');
      else kp.exitPending = true;        // kodiTick plant scheduleDmpExit, wenn running 3 Takte fehlt
    }
    kp.foreign = false;
    kp.playRaw = '';
    KP_KEYB = null;                      // Laufschlüssel gilt nur für diesen Kodi-Lauf (D19)
    kpKeyKid = '';
  }

  // ---- Lautstärke/Stumm aus Kodi (tvkeys) wie die Sprachsteuerung des Launchers (KA:333-377) ----
  // Kodi hält die Fernbedienung exklusiv und zählt Lauter/Leiser/Stumm in tvkeys (D6). flex.js gibt sie
  // als echte Taste an DirectFB weiter (UI.send_key_to_dfb 411/412/413), wie die Sprachsteuerung bei ARC;
  // seit 05.11.2026 auch an den TV-Lautsprechern (der VolumeBar-Store-Weg ließ den Ton am TV stumm).
  // Höchstens eine eingespeiste Taste je 100-ms-Takt (die Sprachsteuerung schickt
  // eine je Befehl, TAP:396); Rest wird nachgeholt, höchstens 8 Stufen. Quittung tvack (3.6a).
  // Nie DOM-Tasten (Schutzregel 10).
  var TVK_MAX_PENDING = 8;
  // ackDue: die letzte Quittung ließ sich nicht schreiben -> im nächsten Takt noch einmal, auch wenn
  // tvkeys gleich bleibt (Kodi wiederholt seine Anmeldung mit demselben Text, den tvkTick überspringt)
  var tvk = { kid: '', up: 0, down: 0, mute: 0, raw: '', seq: 0, pend: 0, tog: 0, ackDue: false };

  function tvkAck(arc) {
    var vb = null;
    try { vb = window.UI.store.state.VolumeBar; } catch (e) { vb = null; }
    var ok = kpWriteFile('tvack', { v: 1, kid: tvk.kid, seq: tvk.seq, arc: arc ? 1 : 0,
      vol: vb ? (vb.volume | 0) : -1, mute: vb && vb.mute === 1 ? 1 : 0 }, tvk.ackDue);
    if (ok === true && tvk.ackDue) log('kodiPlay: tvack wieder geschrieben');
    tvk.ackDue = ok === false;           // nur ein Schreibfehler wird wiederholt, je Serie eine Logzeile
  }

  function tvkTick() {                    // 100 ms, nur solange Kodi bereit meldet (REV:81)
    var st = kodi.active ? kodiState() : null;
    if (!st || !st.ready || !KP_KEYB) { tvk.kid = ''; tvk.raw = ''; tvk.pend = 0; tvk.tog = 0; tvk.ackDue = false; return; }
    var raw = kpRead('tvkeys'), fresh = !!raw && raw !== tvk.raw;
    if (!fresh && !tvk.pend && !tvk.tog && !tvk.ackDue) return;   // nichts Neues, nichts offen
    var arc = false;
    try { arc = parseInt(window.modeljs.sound.getSpeakerArc(), 10) === 2; } catch (e) { arc = false; }
    var retry = tvk.ackDue;              // Quittung aus einem früheren Takt fehlt noch
    if (fresh) {
      tvk.raw = raw;
      var j = kpOpen('tvkeys', raw);
      if (j && typeof j.kid === 'string' && j.seq === (j.seq | 0)) {
        var up = j.up | 0, down = j.down | 0, mute = j.mute | 0;
        if (j.kid !== tvk.kid) { tvk.kid = j.kid; tvk.pend = 0; tvk.tog = 0; } // neuer Lauf: nur übernehmen
        else if (up >= tvk.up && down >= tvk.down && mute >= tvk.mute) {
          tvk.pend = Math.max(-TVK_MAX_PENDING, Math.min(TVK_MAX_PENDING, tvk.pend + (up - tvk.up) - (down - tvk.down)));
          tvk.tog ^= (mute - tvk.mute) & 1;
        }
        tvk.up = up; tvk.down = down; tvk.mute = mute; tvk.seq = j.seq;
        tvkAck(arc);                     // Empfang quittieren (Kodi wartet <= 1 s)
        retry = false;                   // in diesem Takt schon versucht
      }
    }
    if (!tvk.pend && !tvk.tog) {
      if (retry) tvkAck(arc);            // fehlende Quittung nachholen (ackDue)
      return;
    }
    var UI = window.UI;
    try {
      // Immer als echte Taste wie von der Fernbedienung (OA:17384/17484/11822, KA:97-99), auch an den
      // TV-Lautsprechern: Der Store-Weg setzte am TV zwar die Werte, der Ton blieb aber stumm, bis eine echte
      // Lauter-Taste kam (05.11.2026)
      if (tvk.tog) {
        tvk.tog = 0;
        UI.send_key_to_dfb(413);
      } else {
        var d = tvk.pend > 0 ? 1 : -1;
        tvk.pend -= d;
        UI.send_key_to_dfb(d > 0 ? 411 : 412);
      }
    } catch (e) { log('kodiPlay: Lautstärke-Fehler: ' + e); tvk.pend = 0; tvk.tog = 0; }
    // neuer Wert für Kodis Anzeige; sonst eine fehlende Quittung schon während der Stufen nachholen
    if ((!tvk.pend && !tvk.tog) || retry) tvkAck(arc);
  }

  // ---- Hot-Reload (nur Entwickler): Zustand der alten Instanz übernehmen (FB:1039-1062) ----
  // kpSnap gibt keine Geheimnisse heraus (REV:86-90): keine URL (enthält das Token), keine Rohtexte;
  // der Laufschlüssel geht nur über kpKeyOnce (oben). kpSnap zeigt nur den Status.
  window.__flex.kpSnap = function () {
    var o = {}, k;
    for (k in kp) if (kp.hasOwnProperty(k) && k !== 'timer' && k !== 'url' && k !== 'playRaw' && k !== 'ctlRaw') o[k] = kp[k];
    return JSON.parse(JSON.stringify(o));
  };

  // Läuft eine Wiedergabe, baut die neue Instanz die URL aus play.json neu (Kodi löscht play.json
  // erst beim Ende der Wiedergabe), ohne Altersprüfung. Gelingt das nicht (kein Schlüssel
  // übergeben, Datei weg, Debug-Lauf): Wiedergabe beenden. Läuft erst nach dem Laden (later 0),
  // weil kpEnd über homeIdle() die Seite "Bilder" (gal, weiter unten) braucht.
  function kpAdopt() {
    var p = null;
    try { p = prev && prev.kpSnap ? prev.kpSnap() : null; } catch (e) { p = null; }
    if (!p || (!p.sid && !p.dmp)) {
      setLauncherClass('flex-kp-video', false); // verwaiste Durchsicht nie stehen lassen
      return;
    }
    for (var k in p) if (p.hasOwnProperty(k) && kp.hasOwnProperty(k) && k !== 'timer' && k !== 'url') kp[k] = p[k];
    kp.gen++;
    if (!kp.sid) { log('kodiPlay: Zustand der alten Instanz übernommen (nur DMP)'); return; }
    var raw = kpRead('play.json'), o = raw ? kpOpen('play.json', raw) : null;
    kp.url = o && o.sid === kp.sid ? (kp.es ? KP_ES_URL : kpUrl(o)) : '';
    if (!kp.url) { kpEnd('Hot-Reload: Auftrag nicht wiederherstellbar', 'stopped', true, 'kodiGone'); return; }
    kp.playRaw = raw;
    kp.timer = setInterval(function () {
      if (inst.stopped) return;
      try { kpTick(); } catch (e) { log('kodiPlay-Fehler: ' + e); }
    }, KP_POLL_MS);
    inst.timers.push(kp.timer);
    if (kp.ov) setLauncherClass('flex-kp-video', true); // stop() der alten Instanz hat sie entfernt
    log('kodiPlay: Wiedergabe ' + kp.sid + ' der alten Instanz übernommen');
    // Mitten im DMP-Wechsel: die Warteschleife starb mit den Zeitgebern der alten Instanz; hier
    // weiter warten (kp.dmpTries zählt weiter), sonst käme nie ein PlayMedia (kpTick wertet
    // "switching" nicht aus). kpLater prüft beim Feuern wie sonst.
    if (kp.st === 'switching') kpLater(kpWaitDmp, 0);
  }
  later(kpAdopt, 0);

  // ---- Testhilfe (nur mit Debug-Kanal): Ablauf ohne Kodi-Dateien, nur Loopback-URLs ----
  // S3-Test 2 (Kodi läuft, Rückkanal aus P1): __flex.kpDebug('http://127.0.0.1:18080/dvd-576i.mkv',
  // 30, 1.7778), dann __flex.kpDebugCtl({stop:0,pause:1,seekN:0,seq:1}) usw., __flex.kpDebugStop().
  // Kein player.json, keine ctl-Datei; dieselben Wächterbedingungen wie im Ernstfall (ohne Schlüssel).
  if (debug) {
    window.__flex.kpDebug = function (url, resume, dar) {
      if (kp.sid) return 'läuft schon';
      if (typeof url !== 'string' || !/^http:\/\/127\.0\.0\.1:[0-9]{4,5}\/[A-Za-z0-9._\/-]{1,200}$/.test(url)) return 'URL abgelehnt';
      var why = kpGuard({ ready: true }, true);  // Kodi-Bedingung: kodi.active wie im Ernstfall
      if (why) return 'abgelehnt: ' + why;
      var r = +dar || 0;
      kp.debug = true;                   // vor kpStart: kein player.json, keine ctl-Prüfung
      kpStart({ sid: 'dbg' + String(Date.now() % 1e13), url: url, resume: Math.max(0, resume | 0),
        dar: r >= 0.5 && r <= 4 ? r : 0, ov: 0, fb: 0 });
      return 'gestartet';
    };
    window.__flex.kpDebugCtl = function (o) {
      if (!kp.debug || !kp.sid) return 'nur im Debug-Lauf';
      if (!o || typeof o !== 'object') return 'Objekt erwartet';
      kp.ctl = o;
      return 'ok';
    };
    window.__flex.kpDebugStop = function () {
      if (!kp.sid) return 'keine Wiedergabe';
      kpEnd('Debug-Stopp', 'stopped', true, '');
      return 'ok';
    };
  }

  // ---- Seite "Bilder" (Kachel ganz rechts) ----
  // Reiter "Bildschirmschoner": Bilder aus flexss/list.json mit OK an/aus (Pool der Diashow).
  // Reiter "Hintergrund": eines der Sets aus flexss/themes.json (mods/theme) wählen; gilt sofort
  // auf der Startseite, Boot- und Ladebild ab dem nächsten Einschalten (/APPS/flexboot/boot.sh
  // stellt /APPS/flextheme/current um). Gespeichert in flexss/settings.json:
  //   { "wallpaper": "<Set-id>", "disabled": ["<Bildname>", ...] }
  // Der Ordner flexss wird beim Boot für alle beschreibbar: Namen nur nach NAME_RE in URLs/CSS,
  // Texte nur per textContent.
  var NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
  var GAL_COLS = 4, GAL_ROWS = 3;
  var GAL_X = 196, GAL_Y = 240, GAL_DX = 392, GAL_DY = 276;
  // Zurück (8, 461) und Menü (409) schließen nur die Seite; Exit, Home und die App-Tasten
  // schließen sie und gehen an den Launcher (SYS_KEYS, Risiko 4)
  var GAL_BACK = { 8: 1, 409: 1, 461: 1 };
  // openKey/openedAt: die Taste, die die Seite geöffnet hat (Risiko 8, statt einer Markierung am Event)
  var gal = { open: false, tab: 0, idx: -1, el: null, items: [[], []], cards: [], built: '', openedAt: 0,
    openKey: 0 };
  var settings = readSettings();
  // Hot-Reload: ein von der alten Instanz eingefügter Hintergrund folgt der gespeicherten Auswahl
  if (document.getElementById('flex-wp')) applyWallpaper(settings.wallpaper);

  function readJson(path) {
    var raw = null;
    try { raw = window.hisense.file.read(path, 1); } catch (e) { raw = null; }
    if (typeof raw !== 'string' || !raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function readSettings() {
    var s = readJson('flexss/settings.json') || {};
    var out = { wallpaper: '', disabled: [] };
    if (typeof s.wallpaper === 'string' && NAME_RE.test(s.wallpaper)) out.wallpaper = s.wallpaper;
    for (var i = 0; s.disabled && i < s.disabled.length; i++) {
      if (typeof s.disabled[i] === 'string' && NAME_RE.test(s.disabled[i])) out.disabled.push(s.disabled[i]);
    }
    return out;
  }

  function saveSettings() {
    try {
      window.hisense.file.write('flexss/settings.json', JSON.stringify(settings), 1);
    } catch (e) { log('Einstellungen nicht gespeichert: ' + e); }
  }

  function baseName(p) { return p.substring(p.lastIndexOf('/') + 1); }

  function isDisabled(name) { return settings.disabled.indexOf(name) >= 0; }

  // "01_Erzengel_Michael.jpg" -> "Erzengel Michael"
  function prettyName(name) {
    return name.replace(/\.[^.]+$/, '').replace(/^\d+[_ -]*/, '').replace(/_/g, ' ') || name;
  }

  function readThemes() {
    var arr = readJson('flexss/themes.json') || [];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var t = arr[i] || {};
      if (typeof t.id === 'string' && NAME_RE.test(t.id)) {
        out.push({ id: t.id, label: String(t.name || t.id).substr(0, 40),
          thumb: 'static/flex/theme/' + t.id + '/thumb.jpg' });
      }
    }
    return out;
  }

  // gewählten Hintergrund sofort zeigen; nach dem nächsten Start kommt er über die Verknüpfung
  // static/flex/wallpaper.webp -> /APPS/flextheme/current (flex.css), dann ist das hier unnötig.
  // Absolute Adresse: Cobalt löst relative URLs in eingefügten <style> nicht gegen das Dokument,
  // sondern gegen static/flex/ auf (gemessen: .../static/flex/static/flex/theme/...).
  function applyWallpaper(id) {
    var old = document.getElementById('flex-wp');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    if (!id || !NAME_RE.test(id)) return;
    var base = String(window.location.href).replace(/[?#].*$/, '').replace(/[^\/]*$/, '');
    var s = document.createElement('style');
    s.id = 'flex-wp';
    // Startseite und Seite "Alle Apps" (flex.css Schritt 6) zeigen dasselbe Bild
    s.textContent = '.launcher.launcher[data-v-81590a38],div#AllApps[data-v-7aa71c2d],div#AllInputs[data-v-73030bfb]{background-image:url(' + base +
      'static/flex/theme/' + id + '/wallpaper.webp) !important}';
    (document.head || document.documentElement).appendChild(s);
  }

  function openGallery(key) {
    if (gal.open) return;
    var themes = readThemes(), byId = {}, pool = [], i;
    for (i = 0; i < themes.length; i++) byId[themes[i].id] = themes[i];
    var list = readImageList();
    for (i = 0; i < list.length; i++) {
      var name = baseName(list[i]), stem = name.replace(/\.[^.]+$/, '');
      var t = NAME_RE.test(stem) ? byId[stem] : null;
      pool.push({ name: name, label: t ? t.label : prettyName(name),
        thumb: t ? t.thumb : 'static/flex/ss/' + name });
    }
    settings = readSettings();
    gal.items = [pool, themes];
    gal.tab = 0;
    gal.idx = pool.length ? 0 : -1;
    gal.cards = [];
    gal.built = '';
    gal.el = document.createElement('div');
    gal.el.id = 'flex-gallery';
    gal.el.innerHTML = '<div class="fg-title">Bilder</div>' +
      '<div class="fg-tab fg-t0">Bildschirmschoner</div><div class="fg-tab fg-t1">Hintergrund</div>' +
      '<div class="fg-hint"></div><div class="fg-grid"></div><div class="fg-focus"></div>';
    document.body.appendChild(gal.el);
    gal.open = true;
    gal.openedAt = Date.now();
    gal.openKey = key || 0;
    renderGallery();
    log('Seite Bilder geöffnet (' + pool.length + ' Bilder, ' + themes.length + ' Hintergründe)');
  }

  // Das keyup einer verschluckten schließenden Taste behält onKey zurück (swallow -> swallowUp).
  function closeGallery(why) {
    if (!gal.open) return;
    gal.open = false;
    if (gal.el && gal.el.parentNode) gal.el.parentNode.removeChild(gal.el);
    gal.el = null;
    gal.openKey = 0;
    idle = 0;
    log('Seite Bilder geschlossen (' + why + ')');
  }

  // 1-s-Takt: Seite schließen, sobald "Alle Apps" nicht mehr vorne und frei ist (z. B. eine App
  // kam per Cast nach vorne, ein Dialog wie der Standby-Countdown erscheint), Risiko 4 und 7
  function checkGallery() {
    if (gal.open && !galleryValid()) closeGallery('Alle Apps nicht mehr vorne');
  }

  function galSelect(item) {
    if (gal.tab === 0) {
      var k = settings.disabled.indexOf(item.name);
      if (k >= 0) settings.disabled.splice(k, 1);
      else settings.disabled.push(item.name);
      log('Bildschirmschoner: ' + item.name + (k >= 0 ? ' an' : ' aus'));
    } else {
      settings.wallpaper = item.id;
      applyWallpaper(item.id);
      log('Hintergrund: ' + item.id);
    }
    saveSettings();
  }

  function galKey(k) {
    var n = gal.items[gal.tab].length;
    log('Bilder: Taste ' + k + ' (Reiter ' + gal.tab + ', Feld ' + gal.idx + ')');
    if (GAL_BACK[k] === 1 || SS_PASS_KEYS[k] === 1) {
      closeGallery('Taste ' + k);
      return;
    }
    if (gal.idx < 0) { // Reiter
      if (k === 37 || k === 39) gal.tab = k === 37 ? 0 : 1;
      else if ((k === 40 || k === 13) && n) gal.idx = 0;
    } else if (k === 37) {
      if (gal.idx > 0) gal.idx--;
    } else if (k === 39) {
      if (gal.idx < n - 1) gal.idx++;
    } else if (k === 38) {
      gal.idx = gal.idx >= GAL_COLS ? gal.idx - GAL_COLS : -1;
    } else if (k === 40) {
      if (gal.idx + GAL_COLS < n) gal.idx += GAL_COLS;
      else if (Math.floor(gal.idx / GAL_COLS) < Math.floor((n - 1) / GAL_COLS)) gal.idx = n - 1;
    } else if (k === 13) {
      galSelect(gal.items[gal.tab][gal.idx]);
    }
    renderGallery();
  }

  // Karten nur neu bauen, wenn Reiter oder sichtbarer Ausschnitt wechseln; ein Tastendruck ändert
  // sonst nur Klassen, Plaketten und den Fokusrahmen (Neuaufbau mit allen Vorschauen bei jeder
  // Taste machte die Seite am TV sehr träge)
  function buildCards(items, first) {
    var grid = gal.el.querySelector('.fg-grid');
    grid.innerHTML = '';
    gal.cards = [];
    for (var i = first * GAL_COLS; i < items.length && i < (first + GAL_ROWS) * GAL_COLS; i++) {
      var c = document.createElement('div');
      c.className = 'fg-card';
      c.style.left = (GAL_X + (i % GAL_COLS) * GAL_DX) + 'px';
      c.style.top = (GAL_Y + (Math.floor(i / GAL_COLS) - first) * GAL_DY) + 'px';
      c.innerHTML = '<div class="fg-thumb"></div><div class="fg-name"></div><div class="fg-badge"></div>';
      c.firstChild.style.backgroundImage = 'url(' + items[i].thumb + ')';
      c.childNodes[1].textContent = items[i].label;
      grid.appendChild(c);
      gal.cards.push({ i: i, el: c, badge: c.lastChild, cls: '', text: null });
    }
  }

  function renderGallery() {
    var root = gal.el;
    if (!root) return;
    var items = gal.items[gal.tab], active = settings.wallpaper || 'interstellar';
    root.querySelector('.fg-t0').className = 'fg-tab fg-t0' + (gal.tab === 0 ? (gal.idx < 0 ? ' focus' : ' on') : '');
    root.querySelector('.fg-t1').className = 'fg-tab fg-t1' + (gal.tab === 1 ? (gal.idx < 0 ? ' focus' : ' on') : '');
    var hint = !items.length ? 'Keine Bilder gefunden.' : gal.tab === 0 ?
      'OK: Bild im Bildschirmschoner an/aus · Zurück: schließen' :
      'OK: als Hintergrund wählen (Start- und Ladebild ab dem nächsten Einschalten) · Zurück: schließen';
    var h = root.querySelector('.fg-hint');
    if (h.textContent !== hint) h.textContent = hint;
    // so weit scrollen, dass die Zeile mit dem Fokus sichtbar ist
    var row = gal.idx < 0 ? 0 : Math.floor(gal.idx / GAL_COLS);
    var first = Math.max(0, row - GAL_ROWS + 1);
    if (gal.built !== gal.tab + ':' + first) {
      buildCards(items, first);
      gal.built = gal.tab + ':' + first;
    }
    for (var k = 0; k < gal.cards.length; k++) {
      var c = gal.cards[k], it = items[c.i];
      var on = gal.tab === 0 ? !isDisabled(it.name) : it.id === active;
      var cls = 'fg-card' + (gal.tab === 0 && !on ? ' off' : '');
      var text = gal.tab === 0 ? (on ? 'an' : 'aus') : (on ? 'aktiv' : '');
      if (c.cls !== cls) { c.el.className = cls; c.cls = cls; }
      if (c.text !== text) {
        c.badge.textContent = text;
        c.badge.style.display = text ? 'block' : 'none';
        c.text = text;
      }
    }
    var f = root.querySelector('.fg-focus');
    f.style.display = gal.idx < 0 ? 'none' : 'block';
    if (gal.idx >= 0) {
      f.style.left = (GAL_X - 9 + (gal.idx % GAL_COLS) * GAL_DX) + 'px';
      f.style.top = (GAL_Y - 9 + (Math.floor(gal.idx / GAL_COLS) - first) * GAL_DY) + 'px';
    }
  }

  function homeWanted() {
    if (HOME_ON_POWER === 'off') return false;
    if (HOME_ON_POWER === 'nosignal') {
      try {
        return !(window.UI.store.state.Source || {}).currSourceHasSignal;
      } catch (e) {
        return false;
      }
    }
    return true;
  }

  // Beim Start nichts schließen: der Launcher hat die Startseite oft schon vorbereitet; ein
  // popAllModule() würde sie verwerfen und neu aufbauen (= Schwarzbild). Nur Live-TV weglassen.
  // Läuft nur synchron im abgefangenen Boot-Aufruf (hookPushModule), nie aus einem Zeitgeber.
  function showHomeAtBoot() {
    var UI = window.UI;
    var mod = '', sub = '';
    try { mod = UI.getCurrentModuleId(); sub = UI.getCurrentSubModuleId(); } catch (e) { /* früh */ }
    log('Start: Live-TV abgefangen (Modul ' + mod + '/' + sub + ', Startseite im DOM: ' +
      !!document.querySelector('.launcher') + ')');
    bootHome = true;
    later(function () { releaseHome('Zeitlimit'); }, 14000);
    if (sub === 'LauncherHis') return;
    try { UI.store.commit('LauncherHis/setOpenFromNetflix', false); } catch (e) { /* optional */ }
    UI.pushSubModule('LauncherHis', 'LauncherHis', { caller: 'flex power-on' },
      { path: '/LauncherHis/MainPage/LauncherHis/' });
  }

  // Der frühere 3-s-"Notnagel" (openHome/showHome nach INIT_FINISHED bzw. STR_RESUME) ist
  // entfernt (Audit Risiko 2): Er griff genau dann, wenn startModule() KEIN Live-TV pushte, also
  // beim Einschalten per Netflix-/YouTube-/Prime-Taste, Ersteinrichtung, Hotel-Modus, virtuellem
  // Eingang -- und legte die Startseite per popAllModule('module') über die startende App bzw.
  // zerstörte PIN-Dialog oder EULA-Seite. Den Live-TV-Boot deckt der pushModule-Haken ab
  // (startModule() ruft UI.pushModule synchron direkt nach INIT_LOADING, app.js L10078/L9677).
  // Kommt der Haken einmal nicht zum Zug, erscheint Live-TV wie ohne Mod (im Zweifel weniger).

  // Seite "Bilder" und Bildschirmschoner leiten ihren Zustand vom Launcher ab (Schutzregel 6): bei
  // INIT_LOADING, STR_SUSPENDING und STR_SUSPEND sofort zurücksetzen, ohne Player oder Quelle
  // anzufassen (der Launcher räumt den Stapel selbst ab, app.js L9697).
  function resetOwnUi(why) {
    closeGallery(why);
    closeTileMenu(why);
    closeDenonGroup(why);
    bgCloseAbort(why);       // laufendes Schließen und Freigabe verwerfen (Quelle bleibt, wie sie ist)
    if (ss.state !== 'off') stopScreensaver(why, false);
    dmpExit = null;
    kp.exitPending = false;  // wie dmpExit: kein vorgemerkter DMP-Ausstieg über den Standby hinweg
    // kodiPlay: Zustand vergessen, Quelle und Player nicht anfassen (der Launcher räumt selbst ab).
    // Ohne kodiPlay-Zustand bleibt dmpOwn wie in v6 (Diashow).
    if (kp.sid || kp.dmp) kpForeign(why);
    try { kpKodiGone(why, false); } catch (e) { log('kodiPlay-Fehler: ' + e); }
    // Standby bzw. Neustart des Launchers: Kodi beenden (es hielte sonst die Fernbedienung)
    if (kodiPending() || kodi.active || kodiActive()) stopKodi(why);
    kodiHbForget();          // erst danach: kodiActive() oben braucht noch den alten Stand
  }

  function onInitLoading() {
    fx.hard++;
    kodiHb.hold = 0;
    resetOwnUi('INIT_LOADING');
    armBoot(15000); // startModule() folgt unmittelbar (synchron in UI.init, app.js L10078)
    // startModule() ist zurück: Haken sofort entschärfen, auch wenn kein Live-TV kam (Netflix-Taste,
    // Ersteinrichtung, Hotel-Modus; sonst ersetzte er 15 s lang jedes Live-TV, z. B. EXIT oder das
    // Ende einer App, Risiko 6). Dann steht auch fest, ob es zur Startseite geht; sonst
    // Ladebildschirm und Hold sofort weg.
    later(function () {
      if (!bootHome) {
        disarmBoot('Start ohne Live-TV');
        releaseHome('Start nicht zur Startseite');
      }
    }, 0);
  }
  function onInit() { later(fetchWeather, 5000); }
  function onStrSuspending() {
    if (window.__flexDenon) window.__flexDenon.close();
    fx.hard++;
    resetOwnUi('STR_SUSPENDING');
  }
  function onSuspend() {
    fx.hard++;
    resetOwnUi('STR_SUSPEND');
    // bis zum Aufwachen: he() ruft startModule() VOR STR_RESUME (app.js L9687)
    armBoot(24 * 3600000);
    // running bis zum Aufwachen nicht lesen (kodiHbForget); STR_RESUME bzw. INIT_LOADING heben das
    // auf, sonst nach KODI_HB_HOLD_TICKS Takten (Standby kam doch nicht)
    kodiHb.hold = KODI_HB_HOLD_TICKS;
  }
  function onResume() {
    fx.hard++;
    kodiHb.hold = 0;  // startModule() hat schon entschieden (he(), synchron vor STR_RESUME)
    // startModule() lief schon in he(), vor STR_RESUME: nicht neu schärfen, sondern entschärfen
    // (sonst ersetzt der Haken jedes spätere Live-TV, Risiko 6)
    disarmBoot('Aufwachen');
    later(fetchWeather, 5000);
  }

  // ---- Start ----
  function attach(store) {
    // Getter liest nur reaktive Daten: feuert, wenn das Modul registriert wird und bei
    // jedem Neuaufbau der Kacheln. sync: filtert, bevor Vue die Original-Kacheln rendert.
    inst.unwatch.push(store.watch(function (state) {
      var st = launcherState(store);
      // state.LauncherHis lesen = reaktive Abhängigkeit, auch solange das Modul noch fehlt
      return state.LauncherHis && st ? ids(st.mainTileData) + '|' + (st.allAppsData || []).length : '';
    }, function () {
      var st = launcherState(store);
      if (st) {
        try { filterTiles(st); } catch (e) { log('Filterfehler: ' + e); }
      }
    }, { sync: true }));
    inst.unwatch.push(store.watch(function (state) {
      var st = launcherState(store);
      return state.LauncherHis && st ? st.ListTemplateData.length + '|' + st.appRecommendDataFlag : '';
    }, function () {
      var st = launcherState(store);
      if (st) {
        try { cleanHome(store, st); } catch (e) { log('cleanHome-Fehler: ' + e); }
      }
    }));
    // MainTiles-Instanz und Startseiten-Element entstehen erst beim ersten Öffnen der Startseite
    every(function () {
      if (!inst.sawLauncher && document.querySelector('.launcher')) {
        inst.sawLauncher = true;
        log('Startseite im DOM');
      }
      // einzeln abgesichert: ein Fehler in einem Teil darf die anderen nicht blockieren
      try { patchMainTiles(); } catch (e) { log('patchMainTiles-Fehler: ' + e); }
      try { patchAllApps(); } catch (e) { log('patchAllApps-Fehler: ' + e); }
      if (window.__flexDenon) window.__flexDenon.tick(galleryValid(),UI.getCurrentSubModuleId()==='LauncherHis'||UI.getCurrentSubModuleId()==='AllInputs'||UI.getCurrentSubModuleId()==='LiveTV');
      try { var sourceState=launcherState(UI.store);if(sourceState)filterTiles(sourceState);patchDenonInputs();sourceCarousel(); } catch(e) { log('Denon-Quellen: '+e); }
      try { checkGallery(); } catch (e) { log('checkGallery-Fehler: ' + e); }
      try { checkTileMenu(); } catch (e) { log('Kachel-Menü-Fehler: ' + e); }
      try { checkDenonGroup(); } catch (e) { log('Konsolen-Reihe-Fehler: ' + e); }
      try { bgRelTick(); } catch (e) { log('Freigabe-Fehler: ' + e); }
      try { uhStaleTick(); } catch (e) { log('App-beenden-Fehler: ' + e); }
      try { renderWeather(); } catch (e) { log('Wetter-Fehler: ' + e); }
      // Kodi-Aufsicht unabhängig vom Bildschirmschoner (auch wenn SCREENSAVER = null)
      try { kodiBusy = kodiTick(); } catch (e) { kodiBusy = false; log('Kodi-Fehler: ' + e); }
      try { ssTick(); } catch (e) { log('Bildschirmschoner-Fehler: ' + e); }
    }, 1000);
    // Lautstärke/Stumm aus Kodi (tvkeys); tut nichts, solange Kodi nicht bereit meldet
    every(tvkTick, 100);
    every(fetchWeather, WEATHER.everyMin * 60000);

    var st0 = launcherState(store);
    log('flex.js v10 aktiv, LauncherHis ' + (st0 ? 'vorhanden' : 'noch nicht registriert'));
    if (st0) {
      filterTiles(st0);
      cleanHome(store, st0);
    }
    fetchWeather();
  }

  function stop() {
    inst.stopped = true;
    var i;
    for (i = 0; i < inst.unwatch.length; i++) {
      try { inst.unwatch[i](); } catch (e) { /* ignorieren */ }
    }
    // darunter auch der 250-ms-Takt von kodiPlay: eine laufende TV-Wiedergabe übernimmt die neue
    // Instanz über kpSnap (ohne Geheimnisse) und kpKeyOnce (Laufschlüssel, einmal); Quelle und
    // Player hier nicht anfassen (nur Entwickler, Hot-Reload)
    for (i = 0; i < inst.timers.length; i++) {
      clearInterval(inst.timers[i]);
      clearTimeout(inst.timers[i]);
    }
    // Durchsicht (D16) immer entfernen: v6 kennt die Klasse nicht und nähme sie nie wieder weg
    // (Startseite bliebe unsichtbar); eine v7-Nachfolgerin setzt sie in kpAdopt sofort wieder
    setLauncherClass('flex-kp-video', false);
    for (i = 0; i < inst.subs.length; i++) {
      try { window.UI.unsubscribeMessage(inst.subs[i][0], inst.subs[i][1]); } catch (e) { /* ignorieren */ }
    }
    // laufende Freigabe (bgc): ohne Folgen beenden (kein Kodi-Start, kein Ausstieg geplant; ihre
    // Zeitgeber sind oben schon weg). Ist unser DMP-Befehl raus, bekommt die neue Instanz über
    // bgRelSnap nur die Ausstiegs-Freigabe; DMP bleibt bis zur nächsten Taste des Nutzers
    // (Kodi-Kachel: "DMP stand schon", BACK/EXIT auf der Startseite: LAST).
    // Ebenso das Beenden einer App unter der Startseite (bgc.app): die neue Instanz setzt es nicht fort.
    if (bgc) {
      var c0 = bgc;
      bgc = null;
      if (bgRel && c0.sent) bgRel.exit = true;
      else bgRel = null;
      log((c0.app ? 'App beenden' : 'Schließen') + ' abgebrochen (Hot-Reload)');
    }
    if (ss.state !== 'off' || dmpExit) {
      var hadDmp = ss.dmp || !!dmpExit, exitRel = !!(dmpExit && dmpExit.rel);
      ss.gen++;
      ss.state = 'off';
      ss.photo = false;
      dmpExit = null;
      applySsClasses();
      // nur Entwickler (Hot-Reload): DMP ebenfalls nur verlassen, wenn jetzt alles frei ist; ein
      // Ausstieg nach unserer Freigabe bzw. nach Kodi mit deren Freigabe (E1 b)
      if (hadDmp) leaveDmp('Hot-Reload', exitRel);
    }
    removeCover();
    if (window.__flexDenon) window.__flexDenon.close();
    if (gal.el && gal.el.parentNode) gal.el.parentNode.removeChild(gal.el);
    gal.open = false;
    if (tm.el && tm.el.parentNode) tm.el.parentNode.removeChild(tm.el);
    tm.open = false;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKey, true);
    var hold = document.getElementById('flex-hold');
    if (hold && hold.parentNode) hold.parentNode.removeChild(hold);
    try { unpatchMainTiles(); } catch (e) { /* ignorieren */ }
    try { stopDenonSources(); } catch(e) {}
    try { unpatchAllApps(); } catch (e) { /* ignorieren */ }
    if (window.UI && window.UI.__flexPushInst === inst && window.UI.__flexOrigPushModule) {
      window.UI.pushModule = window.UI.__flexOrigPushModule;
      window.UI.__flexPushInst = null;
    }
  }

  // Start-Haken so früh wie möglich setzen: INIT_LOADING und startModule() folgen in UI.init()
  // synchron aufeinander. window.UI entsteht aber erst, wenn app.js das UI-Modul ausführt -- und
  // das passiert NACH diesem Skript (beim Kaltstart gemessen). Darum die Zuweisung
  // "window.UI = ..." per Setter abfangen; zusätzlich kurz pollen, falls das nicht geht.
  function subscribe(name, fn) {
    try {
      window.UI.subscribeMessage(name, fn);
      inst.subs.push([name, fn]);
    } catch (e) { log('Abo ' + name + ' fehlgeschlagen: ' + e); }
  }

  var uiReady = false;

  // Nachrichtennamen: app.js L12662 (INIT_LOADING, INIT_FINISHED, STR_SUSPENDING, STR_SUSPEND,
  // STR_RESUME); UI.subscribeMessage = $on auf dem Nachrichtenbus (L10210-10211). Geschärft wird
  // der Start-Haken erst in onInitLoading (nicht schon hier für 180 s, Schutzregel 7).
  function onUI(how) {
    if (uiReady || inst.stopped || !hookPushModule()) return uiReady;
    uiReady = true;
    subscribe('INIT_LOADING', onInitLoading);
    subscribe('INIT_FINISHED', onInit);
    subscribe('STR_SUSPENDING', onStrSuspending);
    subscribe('STR_SUSPEND', onSuspend);
    subscribe('STR_RESUME', onResume);
    log('Start-Haken gesetzt (' + how + ')');
    return true;
  }

  if (!onUI('beim Laden')) {
    if (!window.UI) {
      try {
        Object.defineProperty(window, 'UI', {
          configurable: true,
          enumerable: true,
          get: function () { return undefined; },
          set: function (v) {
            Object.defineProperty(window, 'UI', { value: v, writable: true, configurable: true, enumerable: true });
            try { onUI('bei Zuweisung von window.UI'); } catch (e) { log('Start-Haken-Fehler: ' + e); }
          }
        });
      } catch (e) { log('window.UI nicht abfangbar: ' + e); }
    }
    (function poll(n) {
      if (uiReady || inst.stopped) return;
      if (window.UI && onUI('Polling')) return;
      if (n < 8000) inst.timers.push(setTimeout(function () { poll(n + 1); }, 25));
    })(0);
  }

  if (!prev) {
    try { holdHome(); } catch (e) { log('holdHome-Fehler: ' + e); }
  } else {
    hideLoading(); // Hot-Reload: ein verbliebener Ladebildschirm darf nicht stehen bleiben
  }

  // Früher ummantelte der Debug-Build modeljs.message.setUIVisible, um das Ein-/Ausblenden der
  // Bildebene mitzuschreiben. Entfernt (Schutzregel 7): genau damit blendet sich der Launcher beim
  // App-Start aus; native Funktionen (modeljs.*) werden nie ummantelt, auch nicht zum Debuggen.

  if (debug && !window.__flexSkipPoller) {
  }
  log('flex.js v10 geladen' + (prev ? ' (Hot-Reload)' : '') + (debug ? ', Debug aktiv' : ''));

  (function wait(n) {
    if (inst.stopped) return;
    var store = window.UI && window.UI.store;
    if (store && store.watch && store.state && window.UI.subscribeMessage) {
      try { attach(store); } catch (e) { log('attach-Fehler: ' + e); }
      return;
    }
    inst.timers.push(setTimeout(function () { wait(n + 1); }, n < 120 ? 500 : 5000));
  })(0);
})();
