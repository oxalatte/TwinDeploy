import React, { useEffect, useMemo, useState, useRef } from 'react';
import { getChanged, getStaged, listTargets, addTarget, updateTarget, deleteTarget, startDeploy, startReplay, listManifests, listRemoteDir, testTarget, connectTarget, disconnectTarget, getConnectionStatus, downloadFile, uploadFile } from './api';

// Helper to read SSE from a fetch Response (Safari-friendly)
class EventSourcePoly {
  constructor(response){ this.response=response; this.listeners={}; this._pump(); }
  on(e,cb){ (this.listeners[e]||(this.listeners[e]=[])).push(cb); }
  close(){ this.controller?.abort(); }
  async _pump(){
    const reader = this.response.body.getReader();
    const decoder = new TextDecoder();
    let buf='';
    while(true){
      const {value,done} = await reader.read(); if(done) break;
      buf += decoder.decode(value,{stream:true});
      let idx;
      while((idx=buf.indexOf('\n\n'))>=0){
        const chunk = buf.slice(0,idx); buf = buf.slice(idx+2);
        const lines = chunk.split('\n');
        let ev='message', data='';
        for(const L of lines){
          if(L.startsWith('event:')) ev = L.slice(6).trim();
          if(L.startsWith('data:')) data += L.slice(5).trim();
        }
        try { data = JSON.parse(data); } catch {}
        (this.listeners[ev]||[]).forEach(fn=>fn(data));
      }
    }
  }
}

// Format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default function App(){
  const [repoPath,setRepoPath] = useState('');
  const [mode,setMode] = useState('staged'); // 'changed' | 'staged'
  const [baseRef,setBaseRef] = useState('HEAD~1');
  const [diff,setDiff] = useState([]);
  const [sel,setSel] = useState({});
  const [targets,setTargets] = useState([]);
  const [targetId,setTargetId] = useState('');
  const [manifests,setManifests] = useState([]);
  const [log,setLog] = useState([]);
  const [dark,setDark] = useState(false);

  // Remote browser state
  const [showRemoteBrowser, setShowRemoteBrowser] = useState(false);
  const [remotePath, setRemotePath] = useState('/');
  const [remoteItems, setRemoteItems] = useState([]);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected'); // 'connected', 'disconnected', 'connecting', 'disconnecting'
  const [connectionError, setConnectionError] = useState('');

  // File editor state
  const [editingFile, setEditingFile] = useState(null); // { path, content, originalContent }
  const [showFileEditor, setShowFileEditor] = useState(false);

  useEffect(()=>{ document.body.classList.toggle('dark', dark); },[dark]);
  useEffect(()=>{ listTargets().then(setTargets); listManifests().then(setManifests); },[]);

  const selectedFiles = useMemo(()=> Object.keys(sel).filter(k=>sel[k]),[sel]);

  async function scan(){
    setDiff([]); setSel({});
    const res = mode==='changed' ? await getChanged(repoPath, baseRef) : await getStaged(repoPath);
    const items = res.items||[]; setDiff(items);
  }

  function toggleAll(v){ const m={}; diff.forEach(x=>m[x.path]=v); setSel(m); }

  // Target form state (FileZilla style)
  const emptyTarget = { name:'', protocol:'ftps', host:'', port:'21', user:'', password:'', key:'', remoteRoot:'', ignoreCertErrors: true };
  const [editing,setEditing] = useState(null); // existing target id or null
  const [tForm,setTForm] = useState(emptyTarget);
  const [tBusy,setTBusy] = useState(false);
  const [tMsg,setTMsg] = useState('');

  function startNewTarget(){ setEditing(null); setTForm(emptyTarget); setTMsg(''); }
  function startEditTarget(t){ setEditing(t.id); setTForm({...t}); setTMsg(''); }
  function changeT(field,val){
    if (field === 'protocol') {
      // Set default port based on protocol
      const defaultPort = val === 'sftp' ? '22' : '21';
      setTForm(f=>({...f, [field]:val, port: f.port ? f.port : defaultPort}));
    } else {
      setTForm(f=>({...f,[field]:val}));
    }
  }
  async function handleTest(){ setTBusy(true); setTMsg('Testing...'); const r=await testTarget(tForm); setTMsg(r.ok?'Connection OK': (r.error||'Failed')); setTBusy(false); }
  async function handleSave(){
    setTBusy(true); setTMsg(editing?'Saving...':'Creating...');
    // Use default ports if empty and clean up remoteRoot
    const defaultPort = tForm.protocol === 'sftp' ? 22 : 21;
    const payload = {
      ...tForm,
      port: tForm.port ? Number(tForm.port) : defaultPort,
      remoteRoot: tForm.remoteRoot.trim() || '/'
    };
    try {
      if(editing){
        const updated = await updateTarget(editing,payload);
        setTargets(ts=> ts.map(x=>x.id===updated.id?updated:x));
        setTMsg('Updated');
      } else {
        const created = await addTarget(payload);
        setTargets(ts=> [created,...ts]); setTargetId(created.id); setTMsg('Created'); setEditing(created.id);
      }
    } catch(e){ setTMsg('Error'); }
    finally { setTBusy(false); }
  }

  // Connection management
  async function handleConnect() {
    if (!targetId) return;
    setConnectionStatus('connecting');
    setConnectionError('');
    try {
      const result = await connectTarget(targetId);
      if (result.ok) {
        setConnectionStatus('connected');
        setLog(l => [...l, `Connected to ${targets.find(t => t.id === targetId)?.host || 'server'}`]);
        // After connecting, refresh the directory listing
        browseRemoteDir('/');
      } else {
        setConnectionStatus('disconnected');
        setConnectionError(result.error || 'Failed to connect');
        setLog(l => [...l, `Connection error: ${result.error || 'Unknown error'}`]);
      }
    } catch (error) {
      setConnectionStatus('disconnected');
      setConnectionError(error.message || 'Connection failed');
      setLog(l => [...l, `Connection error: ${error.message || 'Unknown error'}`]);
    }
  }

  async function handleDisconnect() {
    if (!targetId) return;
    setConnectionStatus('disconnecting');
    try {
      await disconnectTarget(targetId);
      setConnectionStatus('disconnected');
      setRemoteItems([]);
      setLog(l => [...l, `Disconnected from ${targets.find(t => t.id === targetId)?.host || 'server'}`]);
    } catch (error) {
      setConnectionStatus('disconnected'); // Force to disconnected state even if there was an error
      setLog(l => [...l, `Disconnect error: ${error.message || 'Unknown error'}`]);
    }
  }

  // Check connection status when target changes
  useEffect(() => {
    if (targetId) {
      getConnectionStatus(targetId)
        .then(result => {
          setConnectionStatus(result.connected ? 'connected' : 'disconnected');
        })
        .catch(() => setConnectionStatus('disconnected'));
    } else {
      setConnectionStatus('disconnected');
    }
  }, [targetId]);

  // Remote directory browsing
  async function browseRemoteDir(path = '/') {
    if (!targetId || connectionStatus !== 'connected') return;
    setRemoteBusy(true);
    try {
      const result = await listRemoteDir(targetId, path);
      if (result.items) {
        setRemoteItems(result.items);
        setRemotePath(path);
      }
    } catch (error) {
      setLog(l => [...l, `Remote browsing error: ${error.message || 'Failed to browse'}`]);
    } finally {
      setRemoteBusy(false);
    }
  }

  function handleNavigateRemote(item) {
    if (item.type === 'd') {
      browseRemoteDir(item.path);
    }
  }

  function handleRemoteParentDir() {
    if (remotePath === '/') return;
    const parentPath = remotePath.split('/').slice(0, -1).join('/') || '/';
    browseRemoteDir(parentPath);
  }

  function toggleRemoteBrowser() {
    if (!showRemoteBrowser && targetId) {
      setShowRemoteBrowser(true);
      if (connectionStatus === 'connected') {
        browseRemoteDir('/');
      }
    } else {
      setShowRemoteBrowser(false);
    }
  }

  // File operations
  async function handleDownloadFile(item) {
    if (!targetId || connectionStatus !== 'connected') return;
    try {
      setLog(l => [...l, `Downloading ${item.name}...`]);
      const response = await downloadFile(targetId, item.path);

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = item.name;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        setLog(l => [...l, `Downloaded ${item.name} successfully`]);
      } else {
        const error = await response.json();
        setLog(l => [...l, `Download failed: ${error.error || 'Unknown error'}`]);
      }
    } catch (error) {
      setLog(l => [...l, `Download error: ${error.message}`]);
    }
  }

  async function handleEditFile(item) {
    if (!targetId || connectionStatus !== 'connected') return;
    try {
      setLog(l => [...l, `Opening ${item.name} for editing...`]);
      const response = await downloadFile(targetId, item.path);

      if (response.ok) {
        const content = await response.text();
        setEditingFile({
          path: item.path,
          name: item.name,
          content: content,
          originalContent: content
        });
        setShowFileEditor(true);
        setLog(l => [...l, `Opened ${item.name} in editor`]);
      } else {
        const error = await response.json();
        setLog(l => [...l, `Failed to open file: ${error.error || 'Unknown error'}`]);
      }
    } catch (error) {
      setLog(l => [...l, `Edit error: ${error.message}`]);
    }
  }

  async function handleSaveFile() {
    if (!editingFile || !targetId) return;
    try {
      setLog(l => [...l, `Saving ${editingFile.name}...`]);
      const result = await uploadFile(targetId, editingFile.path, editingFile.content);

      if (result.ok) {
        setLog(l => [...l, `Saved ${editingFile.name} successfully`]);
        setEditingFile({ ...editingFile, originalContent: editingFile.content });
      } else {
        setLog(l => [...l, `Save failed: ${result.error || 'Unknown error'}`]);
      }
    } catch (error) {
      setLog(l => [...l, `Save error: ${error.message}`]);
    }
  }

  function handleCloseEditor() {
    if (editingFile && editingFile.content !== editingFile.originalContent) {
      if (!confirm('You have unsaved changes. Are you sure you want to close?')) {
        return;
      }
    }
    setEditingFile(null);
    setShowFileEditor(false);
  }
  async function handleDelete(id){ if(!confirm('Delete this target?')) return; await deleteTarget(id); setTargets(ts=>ts.filter(t=>t.id!==id)); if(targetId===id) setTargetId(''); if(editing===id){ setEditing(null); setTForm(emptyTarget); } }

  async function deploy(){
    if(!repoPath) return alert('Set repoPath');
    if(!targetId) return alert('Pick a target');
    if(selectedFiles.length===0) return alert('Select at least one file');

    // Use current remote browser path as deployment destination
    const selectedTarget = targets.find(t => t.id === targetId);
    let deploymentRoot = remotePath || '/';
    if (!showRemoteBrowser && selectedTarget?.remoteRoot && selectedTarget.remoteRoot.trim()) {
      deploymentRoot = selectedTarget.remoteRoot;
    }

    const res = await fetch('/api/deploy',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        repoPath,
        files: selectedFiles,
        targetId,
        deploymentRoot // Pass the current remote path
      })
    });
    const es = new EventSourcePoly(res);
    es.on('start', d=> setLog(l=>[...l, `Start: ${d.total} files → ${d.target} (${deploymentRoot})`]));
    es.on('progress', d=> setLog(l=>[...l, `Uploaded ${d.index}/${d.total}: ${d.file}`]));
    es.on('error', d=> setLog(l=>[...l, `Error: ${d.error}`]));
    es.on('done', d=> { setLog(l=>[...l, 'Done']); es.close(); listManifests().then(setManifests); });
  }

  async function replay(){
    const id = prompt('Manifest ID to replay (see History list)'); if(!id) return;
    const target = prompt('Replay target id (copy from Targets list)'); if(!target) return;
    const res = await fetch('/api/replay',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ manifestId:id, targetId:target }) });
    const es = new EventSourcePoly(res);
    es.on('start', d=> setLog(l=>[...l, `Replay start: ${d.total} files → ${d.target}`]));
    es.on('progress', d=> setLog(l=>[...l, `Uploaded ${d.index}/${d.total}: ${d.file}`]));
    es.on('error', d=> setLog(l=>[...l, `Error: ${d.error}`]));
    es.on('done', d=> { setLog(l=>[...l, 'Replay done']); es.close(); });
  }



  return (
    <div className="wrap">
      <header className="app-header">
        <h1>TwinDeploy</h1>
        <p>Selective Git file deployment & replay</p>
        <div className="header-actions">
          <button className="btn" onClick={()=>setDark(d=>!d)}>{dark?'Light':'Dark'} mode</button>
          <a className="repo-link" href="https://github.com" target="_blank">Docs</a>
        </div>
      </header>

      <div className="grid">
        <section className="panel accent">
          <h3>1) Repository</h3>
          <div className="row tight">
            <input value={repoPath} onChange={e=>setRepoPath(e.target.value)} placeholder="/absolute/path/to/repo" style={{flex:1}} />
          </div>
          <div className="row tight">
            <label className="radio"><input type="radio" checked={mode==='changed'} onChange={()=>setMode('changed')} /> Changed since</label>
            <input value={baseRef} onChange={e=>setBaseRef(e.target.value)} style={{width:140}} />
            <label className="radio"><input type="radio" checked={mode==='staged'} onChange={()=>setMode('staged')} /> Staged</label>
            <button className="btn primary" onClick={scan}>Scan</button>
          </div>
          <div className="hint">{repoPath? 'Repo path set.' : 'Enter the absolute path to your Git repository.'}</div>
        </section>

        <section className="panel">
          <h3>2) Files <span className="badge">{selectedFiles.length}/{diff.length}</span></h3>
          <div className="toolbar">
            <button className="btn sm" onClick={()=>toggleAll(true)}>All</button>
            <button className="btn sm" onClick={()=>toggleAll(false)}>None</button>
          </div>
          <div className="list files">
            {diff.map(it=> (
              <label key={it.path} className={`file-item ${sel[it.path]?'on':''}`}>
                <input type="checkbox" checked={!!sel[it.path]} onChange={e=>setSel({...sel,[it.path]:e.target.checked})} />
                <span className="mono">{it.path}</span>
              </label>
            ))}
            {diff.length===0 && <div className="empty">No results. Scan first.</div>}
          </div>
        </section>

        <section className="panel wide">
          <h3>File Queue <span className="badge">{selectedFiles.length}</span></h3>
          {selectedFiles.length > 0 && targetId && (
            <div className="file-queue">
              <div className="queue-header">
                <div>Source Path</div>
                <div></div>
                <div>Destination Path</div>
              </div>
              {selectedFiles.map(path => {
                const selectedTarget = targets.find(t => t.id === targetId);

                // Use the current remote browser path as the destination root
                // If remote browser is not active, fall back to target's remoteRoot
                let destinationRoot = remotePath || '/';
                if (!showRemoteBrowser && selectedTarget?.remoteRoot && selectedTarget.remoteRoot.trim()) {
                  destinationRoot = selectedTarget.remoteRoot;
                }

                // Construct the full destination path
                const relativePath = destinationRoot === '/' ?
                  `/${path}` :
                  `${destinationRoot.replace(/\/+$/, '')}/${path}`;

                // Include host information in the full path display
                const hostPrefix = selectedTarget ? `${selectedTarget.host}:` : '';
                const fullDestPath = `${hostPrefix}${relativePath}`;

                return (
                  <div key={path} className="queue-item">
                    <div className="source-path mono" title={`${repoPath}/${path}`}>{path}</div>
                    <div className="arrow">→</div>
                    <div className="dest-path mono" title={fullDestPath}>{fullDestPath}</div>
                  </div>
                );
              })}
            </div>
          )}
          {(selectedFiles.length === 0 || !targetId) && (
            <div className="empty">
              {selectedFiles.length === 0 ? 'No files selected.' : 'Select a target to see destination paths.'}
            </div>
          )}
        </section>

        <section className="panel">
          <h3>3) Targets</h3>
          <div className="target-form">
            <div className="row tight wrap">
              <input placeholder="Name" value={tForm.name} onChange={e=>changeT('name',e.target.value)} style={{flex:'1 1 120px'}} />
              <select value={tForm.protocol} onChange={e=>changeT('protocol',e.target.value)}>
                <option value="ftps">ftps</option>
                <option value="sftp">sftp</option>
              </select>
              <input placeholder="Host" value={tForm.host} onChange={e=>changeT('host',e.target.value)} style={{flex:'1 1 160px'}} />
              <input placeholder={tForm.protocol === 'sftp' ? 'Port (22)' : 'Port (21)'} value={tForm.port} onChange={e=>changeT('port',e.target.value.replace(/[^0-9]/g,''))} style={{width:70}} />
              <input placeholder="User" value={tForm.user} onChange={e=>changeT('user',e.target.value)} style={{flex:'1 1 120px'}} />
              {tForm.protocol==='sftp' && <input placeholder="Key path (optional)" value={tForm.key} onChange={e=>changeT('key',e.target.value)} style={{flex:'2 1 200px'}} />}
              <input type="password" placeholder="Password" value={tForm.password} onChange={e=>changeT('password',e.target.value)} style={{flex:'1 1 140px'}} />
              <input placeholder="Remote root (optional)" value={tForm.remoteRoot} onChange={e=>changeT('remoteRoot',e.target.value)} style={{flex:'2 1 200px'}} />
            </div>
            <div className="row tight">
              {tForm.protocol === 'ftps' && (
                <label className="checkbox">
                  <input type="checkbox" checked={!!tForm.ignoreCertErrors} onChange={e => changeT('ignoreCertErrors', e.target.checked)} />
                  <span>Trust all certificates (fixes hostname mismatch errors)</span>
                </label>
              )}
            </div>
            <div className="row tight">
              <button className="btn sm" disabled={tBusy} onClick={handleTest}>Test</button>
              <button className="btn sm primary" disabled={tBusy || !tForm.host} onClick={handleSave}>{editing?'Update':'Create'}</button>
              <button className="btn sm" disabled={tBusy} onClick={startNewTarget}>New</button>
              {editing && <button className="btn sm" disabled={tBusy} onClick={()=>handleDelete(editing)}>Delete</button>}
              <span className="tmsg mono" style={{marginLeft:'auto'}}>{tMsg}</span>
            </div>
          </div>
          <div className="list compact">
            {targets.map(t=> (
              <div key={t.id} className={`target-item selectable ${t.id===targetId?'active':''}`} onClick={()=>{ setTargetId(t.id); startEditTarget(t); }}>
                <strong>{t.name||t.host}</strong> <code>{t.protocol}</code>
                <span className="id">#{t.id.slice(0,8)}</span>
              </div>
            ))}
            {targets.length===0 && <div className="empty">No targets yet.</div>}
          </div>
        </section>

        <section className="panel">
          <h3>4) Remote Browser</h3>
          <div className="row tight">
            <button className="btn" onClick={toggleRemoteBrowser} disabled={!targetId}>{showRemoteBrowser ? 'Hide Browser' : 'Browse Remote'}</button>
            {targetId && (
              <>
                {connectionStatus === 'disconnected' && (
                  <button className="btn primary" onClick={handleConnect}>Connect</button>
                )}
                {connectionStatus === 'connected' && (
                  <button className="btn danger" onClick={handleDisconnect}>Disconnect</button>
                )}
                {['connecting', 'disconnecting'].includes(connectionStatus) && (
                  <button className="btn" disabled>{connectionStatus === 'connecting' ? 'Connecting...' : 'Disconnecting...'}</button>
                )}
                <div className={`connection-status ${connectionStatus}`}>
                  {connectionStatus === 'connected' ? 'Connected' :
                   connectionStatus === 'disconnected' ? 'Disconnected' :
                   connectionStatus === 'connecting' ? 'Connecting...' : 'Disconnecting...'}
                </div>
              </>
            )}
          </div>
          {connectionError && <div className="connection-error">{connectionError}</div>}
          {showRemoteBrowser && (
            <div className="remote-browser">
              <div className="remote-path-bar">
                <button className="btn sm" onClick={handleRemoteParentDir} disabled={remotePath === '/' || remoteBusy || connectionStatus !== 'connected'}>Parent Dir</button>
                <div className="current-path mono">{remotePath}</div>
                <button className="btn sm" onClick={() => browseRemoteDir(remotePath)} disabled={remoteBusy || connectionStatus !== 'connected'}>Refresh</button>
              </div>
              <div className="remote-items">
                {remoteBusy ? (
                  <div className="loading">Loading...</div>
                ) : connectionStatus !== 'connected' ? (
                  <div className="empty">Connect to server to browse files</div>
                ) : (
                  <>
                    {remoteItems.length === 0 ? (
                      <div className="empty">Empty directory</div>
                    ) : (
                      remoteItems.map(item => (
                        <div
                          key={item.path}
                          className={`remote-item ${item.type === 'd' ? 'folder' : 'file'}`}
                        >
                          <div className="remote-icon">{item.type === 'd' ? '📁' : '📄'}</div>
                          <div className="remote-name" onClick={() => handleNavigateRemote(item)}>{item.name}</div>
                          <div className="remote-size">{item.type !== 'd' ? formatFileSize(item.size) : ''}</div>
                          {item.type !== 'd' && (
                            <div className="remote-actions">
                              <button
                                className="btn sm"
                                onClick={(e) => { e.stopPropagation(); handleDownloadFile(item); }}
                                title="Download file"
                              >
                                ⬇️
                              </button>
                              <button
                                className="btn sm"
                                onClick={(e) => { e.stopPropagation(); handleEditFile(item); }}
                                title="Edit file"
                              >
                                ✏️
                              </button>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="panel">
          <h3>5) Deploy & Replay</h3>
          <div className="row wrap">
            <button className="btn primary" onClick={deploy} disabled={!targetId||selectedFiles.length===0}>Deploy selected</button>
            <button className="btn" onClick={replay}>Replay manifest</button>
          </div>
        </section>

        <section className="panel">
          <h3>6) History</h3>
          <div className="list compact">
            {manifests.slice(0,10).map(m=> (
              <div key={m.id} className="manifest-item">
                <div className="row space">
                  <strong>{m.id.slice(0,8)}</strong>
                  <span>{new Date(m.createdAt).toLocaleString()}</span>
                </div>
                <div className="files-small mono">{m.files.slice(0,4).join(', ')}{m.files.length>4?' …':''}</div>
              </div>
            ))}
            {manifests.length===0 && <div className="empty">No deployments yet.</div>}
          </div>
        </section>

        <section className="panel wide">
          <h3>7) Log</h3>
          <div className="log">
            {log.slice(-40).map((msg,i)=> <div key={i}>{msg}</div>)}
          </div>
          <div className="row tight">
            <button className="btn sm" onClick={()=>setLog([])}>Clear</button>
          </div>
        </section>
      </div>

      {/* File Editor Modal */}
      {showFileEditor && editingFile && (
        <div className="modal-overlay" onClick={handleCloseEditor}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Edit File: {editingFile.name}</h3>
              <button className="btn sm" onClick={handleCloseEditor}>✕</button>
            </div>
            <div className="modal-body">
              <textarea
                value={editingFile.content}
                onChange={(e) => setEditingFile({ ...editingFile, content: e.target.value })}
                className="file-editor"
                spellCheck={false}
              />
            </div>
            <div className="modal-footer">
              <div className="file-path mono">{editingFile.path}</div>
              <div className="modal-actions">
                <button
                  className="btn"
                  onClick={handleCloseEditor}
                >
                  Cancel
                </button>
                <button
                  className="btn primary"
                  onClick={handleSaveFile}
                  disabled={editingFile.content === editingFile.originalContent}
                >
                  Save {editingFile.content !== editingFile.originalContent ? '*' : ''}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
