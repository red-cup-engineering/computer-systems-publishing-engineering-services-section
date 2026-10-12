/**
 * The static search surface: a `/search.json` index and the small
 * first-party client-side script that filters it on `/search`.
 */

/**
 * Build the `/search.json` index: one compact record per published post.
 * @param {{slug:string,title:string,description:string,section:string,tags:string[],date:string}[]} posts
 * @returns {object}
 */
export function buildSearchIndex(posts) {
  return {
    kind: "news-property.search-index/v1",
    items: posts.map((post) => ({
      slug: post.slug,
      title: post.title,
      description: post.description,
      section: post.section,
      tags: post.tags,
      date: post.date,
      url: `/posts/${post.slug}`,
    })),
  };
}

/**
 * The first-party client-side script for `/search`: fetches `/search.json` once
 * and filters it in the browser against the query box. No network calls
 * beyond the one index fetch; no external script.
 * @returns {string}
 */
export function searchClientScript() {
  return `(function(){
  var form=document.getElementById("search-form");
  var input=document.getElementById("search-q");
  var results=document.getElementById("search-results");
  var status=document.getElementById("search-status");
  var index=null;
  function render(items){
    results.innerHTML="";
    for (var i=0;i<items.length;i++){
      var item=items[i];
      var li=document.createElement("li");
      var a=document.createElement("a");
      a.href=item.url; a.textContent=item.title;
      li.appendChild(a);
      var p=document.createElement("p");
      p.textContent=item.description;
      li.appendChild(p);
      results.appendChild(li);
    }
    status.textContent=items.length+(items.length===1?" result":" results");
  }
  function search(query){
    if (!index) return;
    var q=query.trim().toLowerCase();
    if (q==="") { render([]); status.textContent=""; return; }
    var matches=index.items.filter(function(item){
      var hay=(item.title+" "+item.description+" "+item.tags.join(" ")+" "+item.section).toLowerCase();
      return hay.indexOf(q)!==-1;
    });
    render(matches);
  }
  fetch("/search.json").then(function(r){return r.json();}).then(function(data){
    index=data;
    if (input.value.trim()!=="") search(input.value);
  }).catch(function(){ status.textContent="Search index unavailable."; });
  form.addEventListener("submit", function(event){ event.preventDefault(); search(input.value); });
  input.addEventListener("input", function(){ search(input.value); });
})();`;
}
