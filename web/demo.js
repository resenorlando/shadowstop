/* Presentation layer. All shade values come from recorded or live engine results. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const pct = value => value == null ? '—' : `${Math.round(value * 100)}%`;
  const money = value => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(value);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let hero, scene, before, after, verdict, map, viewer, tiles, googleConfigured = false;
  let mode = 'before', stage = 'discover', frame = 20, timer, shadeVisible = false, heatPromise;
  let heat = { before: null, after: null }, verified = false, liveRun = false;

  function toast(message) {
    $('toast').textContent = message; $('toast').hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('toast').hidden = true; }, 6500);
  }
  async function api(path, options = {}) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), options.timeout || 30000);
    try {
      const response = await fetch(path, { signal: controller.signal, method: options.body ? 'POST' : 'GET',
        headers: options.body ? {'Content-Type':'application/json'} : {}, body: options.body ? JSON.stringify(options.body) : undefined });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `Request failed (${response.status})`);
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('This request took too long. The recorded study is still available.');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function renderMetrics() {
    if (!before || !after) return;
    $('beforeMetric').innerHTML = `${Math.round(before.score * 100)}<small>%</small>`;
    $('afterMetric').innerHTML = `${Math.round(after.score * 100)}<small>%</small>`;
    $('gainLabel').textContent = `+${Math.round((after.score - before.score) * 100)} points of daily shade`;
    $('exposureLabel').textContent = pct(1 - before.score);
    $('compareBefore').textContent = pct(before.score); $('compareAfter').textContent = pct(after.score);
    const cost = verdict?.cost_gbp ?? hero?.design?.cost_gbp;
    $('designCost').textContent = cost == null ? '—' : money(cost); $('compareCost').textContent = $('designCost').textContent;
    $('evidenceLabel').textContent = verified ? (liveRun ? 'New design · verified by the local engine' : 'Recorded Gemini design · reverified locally') : 'Recorded Gemini run · geometric shade study';
    $('dataMode').textContent = liveRun ? 'LIVE DESIGN · LOCALLY VERIFIED' : verified ? 'RECORDED DESIGN · LIVE VERIFICATION' : 'RECORDED STUDY · JULY 2026';
    $('briefBtn').disabled = !verified || !verdict?.accepted || liveRun;
    $('briefBtn').title = liveRun ? 'Use the workbench to review and export the new design.' : '';
    updateTimeline();
  }
  function renderAttempts(attempts, recorded = true) {
    $('attempts').innerHTML = attempts.map((attempt, i) => `<article class="attempt ${attempt.accepted ? 'accepted' : ''}"><div class="attempt-top"><span>${i === 0 ? '01 / The obvious fix' : `${String(i + 1).padStart(2, '0')} / ${attempt.by === 'search' ? 'Geometry search' : 'Gemini redesign'}`}</span><span class="verdict">${attempt.accepted ? '✓ PASSED' : '↻ REJECTED'}</span></div><p><strong>${pct(attempt.score_after)} daily shade · ${money(attempt.cost_gbp)}</strong></p>${attempt.accepted ? '<p>Passes every geometric check.</p>' : `<details class="attempt-details"><summary>See the counterexample</summary><p>${esc(attempt.reason)}</p></details>`}</article>`).join('');
    $('liveStatus').textContent = recorded ? 'Recorded redesign history. Final design rechecked against current rules.' : 'New design run. All verdicts are from the deterministic verifier.';
  }
  function updateTimeline() {
    frame = Number($('timeSlider').value);
    const rows = (mode === 'after' ? after : before)?.by_time;
    const row = rows?.[frame]; if (!row) return;
    $('timeValue').value = row.t; $('timeValue').textContent = row.t;
    $('instantShade').textContent = pct(row.shade);
    $('sunPosition').textContent = `Sun azimuth ${row.sun_az.toFixed(1)}° · elevation ${row.sun_el.toFixed(1)}°`;
    if (map?.isStyleLoaded()) {
      map.setLight({ anchor:'map', position:[1.5, row.sun_az, 90 - row.sun_el], color:'#fff1d4', intensity:.45 });
      if (map.getLayer('canopy')) map.setLayoutProperty('canopy', 'visibility', mode === 'after' && scene?.proposals?.[0]?.shape === 'box' ? 'visible' : 'none');
      if (map.getLayer('waiting-fill')) map.setPaintProperty('waiting-fill', 'fill-color', mode === 'after' ? '#d1efa2' : '#efad7d');
      drawHeat();
    }
    if (viewer && !googleMapHidden()) {
      const time = `${scene?.date || hero.date}T${row.t}:00+01:00`;
      viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(time);
      viewer.scene.requestRender();
    }
  }
  function googleMapHidden() { return $('googleMap').hidden; }
  function setMode(next) {
    mode = next;
    $('beforeBtn').classList.toggle('selected', mode === 'before');
    $('afterBtn').classList.toggle('selected', mode === 'after');
    updateTimeline();
  }
  function setStage(next) {
    if (!hero) return;
    stage = next; document.body.dataset.stage = next;
    document.querySelectorAll('.nav-step').forEach(button => button.classList.toggle('active', button.dataset.stage === next));
    $('verificationPanel').hidden = next !== 'verify';
    if (next === 'compare') { pause(); $('compareDialog').showModal(); return; }
    if (next === 'discover') { $('startBtn').innerHTML = '<span>Explore this stop</span><span>↗</span>'; focusMap(false); }
    if (next === 'verify') {
      $('startBtn').innerHTML = '<span>See the street transformation</span><span>→</span>';
      focusMap(true); ensureHeat();
      if (matchMedia('(max-width: 900px)').matches) $('verificationPanel').scrollIntoView({ behavior:reducedMotion ? 'instant' : 'smooth', block:'start' });
    }
  }
  function focusMap(close = stage === 'verify') {
    if (map && googleMapHidden()) map.flyTo({center:[hero.stop.lon, hero.stop.lat], zoom:close ? 19.3 : 16.2,
      pitch:close ? 48 : 43, bearing:close ? -22 : -18, duration:reducedMotion ? 0 : 2100, essential:true,
      padding:{left:0, right:close ? 300 : 60, top:80, bottom:150}});
    if (viewer && !googleMapHidden()) flyGoogle(close);
  }
  function ll(x,y) {
    const origin = scene || hero.stop;
    return [origin.lon + x / (111320 * Math.cos(origin.lat * Math.PI / 180)), origin.lat + y / 110540];
  }
  function polygon(points) { const coords = points.map(([x,y]) => ll(x,y)); return {type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[...coords,coords[0]]]}}; }
  function footprint(proposal) {
    const [w,h] = proposal.size, [cx,cy] = proposal.center, r = (proposal.rotation_deg || 0) * Math.PI / 180;
    return [[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].map(([x,y]) => [cx+x*Math.cos(r)-y*Math.sin(r), cy+x*Math.sin(r)+y*Math.cos(r)]);
  }
  function addGeometry() {
    if (!scene || !map?.isStyleLoaded()) return;
    const waiting = polygon(scene.waiting_area);
    if (map.getSource('waiting')) map.getSource('waiting').setData(waiting);
    else {
      map.addSource('waiting',{type:'geojson',data:waiting});
      map.addLayer({id:'waiting-fill',type:'fill',source:'waiting',paint:{'fill-color':'#efad7d','fill-opacity':.42}});
      map.addLayer({id:'waiting-line',type:'line',source:'waiting',paint:{'line-color':'#f5f6de','line-width':2,'line-dasharray':[2,1]}});
    }
    const proposal = scene.proposals?.[0];
    if (proposal?.shape === 'box') {
      const data = polygon(footprint(proposal));
      if (map.getSource('proposal')) {
        map.getSource('proposal').setData(data);
        map.setPaintProperty('canopy','fill-extrusion-height',proposal.z1);
        map.setPaintProperty('canopy','fill-extrusion-base',proposal.z0);
      }
      else {
        map.addSource('proposal',{type:'geojson',data});
        map.addLayer({id:'canopy',type:'fill-extrusion',source:'proposal',layout:{visibility:mode === 'after' ? 'visible' : 'none'},paint:{'fill-extrusion-color':'#c9dca3','fill-extrusion-height':proposal.z1,'fill-extrusion-base':proposal.z0,'fill-extrusion-opacity':.8}});
      }
    }
    updateTimeline();
  }
  function initMap() {
    if (!window.maplibregl) { $('mapFallback').hidden = false; return; }
    try {
      map = new maplibregl.Map({container:'map',center:[hero.stop.lon,hero.stop.lat],zoom:16.2,pitch:43,bearing:-18,
        maxZoom:20,attributionControl:{compact:true},style:{version:8,sources:{aerial:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:19,attribution:'Imagery © Esri, Maxar, Earthstar Geographics'}},layers:[{id:'aerial',type:'raster',source:'aerial',paint:{'raster-saturation':-.32,'raster-contrast':.12,'raster-brightness-max':.88}}]}});
      map.on('load',() => { addGeometry(); focusMap(false); });
      map.on('error',event => {
        if (event.error?.message?.includes('WebGL')) { $('mapFallback').hidden = false; }
      });
      const pin = document.createElement('button'); pin.className='stop-marker hero'; pin.setAttribute('aria-label','Inspect Hackney Town Hall bus stop'); pin.addEventListener('click',() => setStage('verify'));
      new maplibregl.Marker({element:pin}).setLngLat([hero.stop.lon,hero.stop.lat]).addTo(map);
    } catch { $('mapFallback').hidden = false; }
  }
  async function ensureHeat() {
    if (!scene || !verified) return;
    if (heatPromise) return heatPromise;
    heatPromise = (async () => {
      const results = await Promise.allSettled(['before','after'].map(key => api('/api/heatgrid',{body:{scene,include_proposals:key === 'after',radius:26,step:1,minutes_step:15},timeout:60000})));
      results.forEach((result,i) => { if (result.status === 'fulfilled') heat[i === 0 ? 'before' : 'after'] = result.value; });
      if (results.some(result => result.status === 'rejected')) toast('The detailed shade layer could not load. Waiting-area scores are still available.');
      drawHeat();
    })();
    return heatPromise;
  }
  const heatCanvas = document.createElement('canvas');
  function drawHeat() {
    if (!map?.isStyleLoaded()) return;
    const grid = heat[mode];
    if (!shadeVisible || !grid) { if (map.getLayer('shade-heat')) map.setLayoutProperty('shade-heat','visibility','none'); return; }
    heatCanvas.width=grid.nx; heatCanvas.height=grid.ny;
    const ctx=heatCanvas.getContext('2d'), pixels=ctx.createImageData(grid.nx,grid.ny), values=grid.frames[Math.min(frame,grid.frames.length-1)];
    for(let y=0;y<grid.ny;y++) for(let x=0;x<grid.nx;x++) {
      const value=values[y*grid.nx+x], i=((grid.ny-1-y)*grid.nx+x)*4;
      if(value<0) continue;
      const sun=value/100;
      pixels.data[i]=Math.round(140+sun*103); pixels.data[i+1]=Math.round(197-sun*20); pixels.data[i+2]=Math.round(142-sun*50);pixels.data[i+3]=175;
    }
    ctx.putImageData(pixels,0,0);
    const half=grid.step/2,x0=grid.xs[0]-half,x1=grid.xs.at(-1)+half,y0=grid.ys[0]-half,y1=grid.ys.at(-1)+half;
    const data={url:heatCanvas.toDataURL(),coordinates:[ll(x0,y1),ll(x1,y1),ll(x1,y0),ll(x0,y0)]};
    if(map.getSource('shade-heat')) {map.getSource('shade-heat').updateImage(data); map.setLayoutProperty('shade-heat','visibility','visible');}
    else {map.addSource('shade-heat',{type:'image',...data});map.addLayer({id:'shade-heat',type:'raster',source:'shade-heat',paint:{'raster-opacity':.75,'raster-fade-duration':0}},'waiting-fill');}
  }
  function pause() {clearInterval(timer);timer=null;$('playBtn').textContent='▶';$('playBtn').setAttribute('aria-label','Play sun timeline');}
  $('playBtn').addEventListener('click',() => {
    if(timer) return pause();
    $('playBtn').textContent='Ⅱ';$('playBtn').setAttribute('aria-label','Pause sun timeline');
    if(Number($('timeSlider').value)===36)$('timeSlider').value=0;
    timer=setInterval(() => {let next=Number($('timeSlider').value)+1;if(next>36){pause();return;}$('timeSlider').value=next;updateTimeline();},350);
  });
  $('timeSlider').addEventListener('input',() => {pause();updateTimeline();});
  $('beforeBtn').addEventListener('click',() => setMode('before'));$('afterBtn').addEventListener('click',() => setMode('after'));
  document.querySelectorAll('.nav-step').forEach(button => button.addEventListener('click',() => setStage(button.dataset.stage)));
  $('startBtn').addEventListener('click',() => setStage(stage==='verify'?'compare':'verify'));
  $('siteBtn').addEventListener('click',() => setStage('verify'));$('closeVerify').addEventListener('click',() => setStage('discover'));
  $('compareBtn').addEventListener('click',() => setStage('compare'));$('streetBtn').addEventListener('click',() => setStage('compare'));
  $('closeCompare').addEventListener('click',() => $('compareDialog').close());
  $('compareDialog').addEventListener('close',() => setStage('verify'));
  $('compareSlider').addEventListener('input',event => {const value=event.target.value;$('afterPhoto').style.clipPath=`inset(0 0 0 ${value}%)`;$('wipeLine').style.left=`${value}%`;});
  $('methodBtn').addEventListener('click',() => $('methodDialog').showModal());$('closeMethod').addEventListener('click',() => $('methodDialog').close());
  $('recenterBtn').addEventListener('click',() => focusMap());
  $('shadeBtn').addEventListener('click',async () => {
    if(!googleMapHidden()) {toast('Use Aerial to explore the computed ground shade layer.');return;}
    shadeVisible=!shadeVisible;$('shadeBtn').setAttribute('aria-pressed',String(shadeVisible));$('shadeKey').hidden=!shadeVisible;
    if(shadeVisible){if(!verified){toast('The detailed layer needs the local verifier.');shadeVisible=false;$('shadeKey').hidden=true;$('shadeBtn').setAttribute('aria-pressed','false');return;}toast('Computed ground shade: green = shaded · amber = direct sun. Scores sample people at 1.2 m.');await ensureHeat();focusMap(true);}
    drawHeat();
  });

  async function checkGoogle() {
    try { const status=await api('/api/google/status');googleConfigured=status.configured; }
    catch {googleConfigured=false;}
    $('googleStatus').textContent=googleConfigured?'A Google Maps key is configured. Google 3D and Solar availability will be checked on request.':'Google services are not connected. This demo uses Esri aerial imagery and its own sun-and-shade engine. Solar API is optional building context.';
    $('tilesBtn').title=googleConfigured?'Load Google Photorealistic 3D Tiles':'Requires GOOGLE_MAPS_API_KEY with Map Tiles API enabled';
  }
  function loadScript(url) {return new Promise((resolve,reject) => {const script=document.createElement('script');script.src=url;script.onload=resolve;script.onerror=() => reject(new Error('The 3D renderer could not be loaded.'));document.head.appendChild(script);});}
  function flyGoogle(close=true) {
    const C=Cesium, target=C.Cartesian3.fromDegrees(hero.stop.lon,hero.stop.lat,18);
    viewer.camera.flyToBoundingSphere(new C.BoundingSphere(target,close?70:500),{duration:reducedMotion?0:2.5,offset:new C.HeadingPitchRange(C.Math.toRadians(-20),C.Math.toRadians(-38),close?160:1100)});
  }
  $('tilesBtn').addEventListener('click',async () => {
    if(!googleConfigured){toast('Google 3D needs a Maps Platform key with Map Tiles API enabled. The aerial demo is ready to use.');return;}
    const button=$('tilesBtn');button.disabled=true;
    try {
      if(!viewer){
        // Check permissions before downloading or constructing the renderer.
        await api('/api/google/tiles/root.json');
        window.CESIUM_BASE_URL='https://cesium.com/downloads/cesiumjs/releases/1.121/Build/Cesium/';
        const css=document.createElement('link');css.rel='stylesheet';css.href=window.CESIUM_BASE_URL+'Widgets/widgets.css';document.head.appendChild(css);
        await loadScript(window.CESIUM_BASE_URL+'Cesium.js');
        $('googleMap').hidden=false;
        viewer=new Cesium.Viewer('googleMap',{globe:false,baseLayer:false,baseLayerPicker:false,animation:false,timeline:false,geocoder:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,fullscreenButton:false,selectionIndicator:false,infoBox:false,requestRenderMode:true});
        tiles=await Cesium.Cesium3DTileset.fromUrl('/api/google/tiles/root.json',{showCreditsOnScreen:true,maximumScreenSpaceError:12});
        viewer.scene.primitives.add(tiles);
        viewer.cesiumWidget.creditDisplay.addStaticCredit(new Cesium.Credit('<a href="https://maps.google.com/" target="_blank" rel="noopener">Google Maps</a>',true));
        tiles.tileFailed.addEventListener(() => toast('Some Google 3D tiles could not load. Aerial view remains available.'));
        viewer.scene.skyAtmosphere.show=true;
      }
      $('googleMap').hidden=false;$('map').hidden=true;$('tilesBtn').classList.add('selected');$('aerialBtn').classList.remove('selected');
      $('siteCallout').hidden=true;flyGoogle(stage==='verify');updateTimeline();
    } catch(error) {toast(error.message);$('googleMap').hidden=true;$('map').hidden=false;}
    finally {button.disabled=false;}
  });
  $('aerialBtn').addEventListener('click',() => {$('googleMap').hidden=true;$('map').hidden=false;$('siteCallout').hidden=false;$('aerialBtn').classList.add('selected');$('tilesBtn').classList.remove('selected');map?.resize();});
  $('solarBtn').addEventListener('click',async () => {
    const button=$('solarBtn');button.disabled=true;$('solarResult').textContent='Checking nearest building…';
    try {const result=await api(`/api/google/solar?lat=${hero.stop.lat}&lon=${hero.stop.lon}`);$('solarResult').innerHTML=`<p><b>Google Solar · ${esc(result.imagery_quality)} imagery</b><br>${result.max_sunshine_hours_per_year==null?'Sunshine estimate unavailable':`${Math.round(result.max_sunshine_hours_per_year).toLocaleString()} maximum sunshine hours/year`}${result.roof_area_m2==null?'':` · ${Math.round(result.roof_area_m2).toLocaleString()} m² roof`}<br>Nearest building roof only. This does not measure bus-stop shade.</p>`;}
    catch(error){$('solarResult').textContent=error.message;}
    finally{button.disabled=false;}
  });

  $('liveBtn').addEventListener('click',async () => {
    if(!scene){toast('The local verifier is not available. Open the workbench to connect.');return;}
    const button=$('liveBtn');button.disabled=true;$('liveStatus').textContent='Gemini is designing under £8,000. The verifier will check every attempt…';
    try {
      const response=await api('/api/propose',{body:{scene:{...scene,proposals:[]},budget_gbp:8000},timeout:150000});
      renderAttempts(response.attempts,false);
      const accepted=response.attempts.filter(a=>a.accepted).at(-1);
      if(!accepted){$('liveStatus').textContent='No new design passed. The recorded verified design remains selected.';return;}
      const nextScene=response.final_scene;
      const results=await Promise.all([api('/api/score',{body:{scene:nextScene}}),api('/api/score',{body:{scene:nextScene,include_proposals:true}})]);
      try {const saved=JSON.stringify(response);localStorage.setItem('shadowstop:lastPropose',saved);localStorage.setItem('shadowstop:lastPropose:'+nextScene.id,saved);} catch {toast('This browser could not save the run for the workbench.');}
      before=results[0];after=results[1];scene=nextScene;verdict=accepted;verified=true;liveRun=true;heat={before:null,after:null};heatPromise=null;
      $('photoBefore').src=hero.photo_before;$('photoAfter').src=hero.photo_before;
      document.querySelector('.photo-label.right').textContent='NEW DESIGN · IMAGE NOT GENERATED';
      document.querySelector('.photo-credit').textContent='A new design was verified. This is the original street photo on both sides; the archived illustration belongs to the earlier design. Use the workbench to render the new proposal.';
      $('designMaterial').textContent=accepted.material?.replace(/_/g,' ') || 'Verified material';
      $('liveStatus').textContent=response.argon_error?'Gemini was unavailable; deterministic search produced this accepted design. Open workbench → Replay last run to continue.':'New proposal accepted. Open workbench → Replay last run to render this design on the street.';
      $('approveCheck').checked=false;$('exportBtn').disabled=true;renderMetrics();addGeometry();ensureHeat();
    } catch(error){$('liveStatus').textContent=error.message;}
    finally{button.disabled=false;}
  });
  $('briefBtn').addEventListener('click',() => {
    if(!verified || !verdict?.accepted || liveRun) return;
    $('briefContent').innerHTML=`<p><b>${esc(hero.stop.name)}</b><br>Stop ${esc(scene.id)} · ${esc(scene.date)}</p><p>Daily direct-sun shade: <b>${pct(before.score)} → ${pct(after.score)}</b><br>Indicative investment: <b>${money(verdict.cost_gbp)}</b><br>Worst-time proposed shade: <b>${pct(after.worst_time_shade)}</b> at ${esc(after.worst_time)}.</p><p>Source: recorded Gemini proposal, reverified by the local geometric engine. Historic street illustration is illustrative.</p>`;
    $('approveCheck').checked=false;$('exportBtn').disabled=true;$('briefDialog').showModal();
  });
  $('closeBrief').addEventListener('click',() => $('briefDialog').close());
  $('approveCheck').addEventListener('change',event => {$('exportBtn').disabled=!event.target.checked;});
  $('exportBtn').addEventListener('click',() => {
    if(!$('approveCheck').checked || !verified || !verdict?.accepted) return;
    const text=`SHADOWSTOP · COUNCIL CONCEPT BRIEF\n\n${scene.name}\nOSM stop: ${scene.id}\nStudy: ${scene.date}, 09:00–18:00 BST\n\nDaily waiting-area shade: ${pct(before.score)} → ${pct(after.score)}\nWorst-time proposed shade: ${pct(after.worst_time_shade)} at ${after.worst_time}\nIndicative cost: ${money(verdict.cost_gbp)}\nBudget: £8,000\nMaterial: ${scene.proposals[0].material}\n\nRecorded Gemini proposal, reverified locally. Operator reviewed for concept export.\n\nMETHOD\nNOAA sun position, deterministic ray casting, 0.5 m grid, 1.2 m sampling height, 15-minute intervals. Shade is direct sunlight blocked, not temperature or UV protection. OSM heights and foliage may be estimated. Costs are indicative. Geometric pass is not structural or planning approval. Subject to site survey and accessibility review.\n\nGEOMETRY\n${JSON.stringify(scene.proposals[0],null,2)}\n`;
    const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='ShadowStop-Hackney-council-brief.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Council concept brief exported.');
  });

  async function init() {
    try {
      hero=await api('assets/hero.json');before=hero.before;after=hero.after;
      renderMetrics();renderAttempts(hero.attempts);initMap();checkGoogle();
      const result=await api('/api/demo/verified',{timeout:45000});
      scene=result.scene;verdict=result.verdict;
      if(result.rules?.peak_heat_hours){const [lo,hi]=result.rules.peak_heat_hours;$('worstRule').textContent=`At least ${Math.round(result.rules.min_worst_time_shade*100)}% shade at the worst time from ${String(lo).padStart(2,'0')}:00–${String(hi).padStart(2,'0')}:00 BST.`;}
      if(!verdict.accepted) throw new Error('The recorded design no longer passes the verifier.');
      before=result.before;after=result.after;verified=true;renderMetrics();addGeometry();
      if(stage==='verify') ensureHeat();
    } catch(error) {
      if(hero){$('evidenceLabel').textContent='Recorded study · local verification unavailable';$('dataMode').textContent='RECORDED STUDY · VERIFIER UNAVAILABLE';$('liveStatus').textContent=error.message;$('briefBtn').disabled=true;}
      else toast('The study could not load. Open the workbench to continue.');
    }
  }
  init();
})();
