/* content.html 剧目展示管理：真实 /v1/plays 接线 v20260922 */
(function(){
  function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function badge(g){ g=String(g||""); var c="badge-gold"; if(g.indexOf("折子")>=0)c="badge-info"; else if(g.indexOf("现代")>=0)c="badge-success"; else if(g.indexOf("神话")>=0||g.indexOf("历史")>=0)c="badge badge-info"; return '<span class="badge '+c+'">'+esc(g||"—")+'</span>'; }
  function loadPlays(){
    var tb=document.getElementById("contentPlaysTbody"); if(!tb||!window.QAXQJT_API) return;
    return QAXQJT_API.get("/v1/plays",{query:{page:1,pageSize:200}}).then(function(resp){
      var rows=Array.isArray(resp)?resp:(resp&&(resp.items||resp.list||resp.rows))||[];
      var b=document.getElementById("playMgmtBadge"); if(b) b.textContent="共 "+rows.length+" 部 · 前台展示 "+rows.filter(function(p){return p.status!=="deleted";}).length+" 部";
      if(!rows.length){ tb.innerHTML='<tr><td colspan="11" style="text-align:center;padding:30px;color:#999;">暂无剧目数据</td></tr>'; return; }
      tb.innerHTML=rows.map(function(p){
        var t=esc(p.title||""); var ch=t.charAt(0)||"剧";
        var hot=p.isHot||p.is_hot;
        var dt=String(p.updatedAt||p.createdAt||"").slice(0,10);
        return '<tr><td style="text-align:center;vertical-align:middle;"><input type="checkbox" class="batch-row-check" style="width:17px;height:17px;cursor:pointer;accent-color:var(--primary,#0F4C81);" /></td>'+
        '<td style="font-family:monospace;font-weight:600;color:var(--primary-dark);">'+esc(p.id||"—")+'</td>'+
        '<td><div class="poster-preview">'+esc(ch)+'</div></td>'+
        '<td style="font-weight:600;color:var(--primary-dark);font-family:KaiTi,STKaiti,serif;font-size:1rem;">《'+t+'》</td>'+
        '<td>'+badge(p.genre)+'</td>'+
        '<td><span class="badge '+(p.status==="active"?"badge-success":"badge-info")+'">'+(p.status==="active"?"● 展示":"○ 隐藏")+'</span></td>'+
        '<td>'+esc(p.sortOrder||"—")+'</td>'+
        '<td>'+(hot?'<span class="hot-tag">🔥 热门</span>':"—")+'</td>'+
        '<td><div class="adapt-tags"><span class="adapt-tag">'+esc(p.subtitle||p.genre||"")+'</span></div></td>'+
        '<td>'+esc(dt||"—")+'</td>'+
        '<td><div class="admin-table-actions"><button class="btn btn-secondary btn-sm">👁</button><button class="btn btn-primary btn-sm">✏️</button><button class="btn btn-outline-dark btn-sm">🗑</button></div></td></tr>';
      }).join("");
      try{ if(window.QinPagination&&QinPagination.init) QinPagination.init(); }catch(_){}
    }).catch(function(){ var tb2=document.getElementById("contentPlaysTbody"); if(tb2) tb2.innerHTML='<tr><td colspan="11" style="text-align:center;padding:30px;color:#999;">真实剧目加载失败（未登录或网络异常）</td></tr>'; });
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",loadPlays); else loadPlays();
})();