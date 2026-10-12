/** First-party house-ad loader; the page supplies slots and the configured server. */
export function houseAdClientScript() {
  return `(function(){
  var slots=document.querySelectorAll('.ad-slot[data-ad-server]');
  for(var i=0;i<slots.length;i++)(function(el){
    var base=el.dataset.adServer, slot=el.dataset.slot, property=el.dataset.property, context=el.dataset.context||'';
    if(!base||!slot||!property)return;
    fetch(base+'/ad?slot='+encodeURIComponent(slot)+'&property='+encodeURIComponent(property)+(context?'&context='+encodeURIComponent(context):''))
      .then(function(response){return response.ok?response.json():null;})
      .then(function(data){
        if(!data||!data.creative||!data.creative.id||!data.creative.title)return;
        var link=document.createElement('a');
        link.href=base+'/click?slot='+encodeURIComponent(slot)+'&property='+encodeURIComponent(property)+'&creative='+encodeURIComponent(data.creative.id);
        link.rel='sponsored noopener noreferrer';
        var label=document.createElement('span');
        label.className='ad-slot__label';
        label.textContent='From the publisher';
        var title=document.createElement('strong');
        title.textContent=data.creative.title;
        link.appendChild(title);
        link.appendChild(document.createTextNode(' — '+(data.creative.body||'')));
        el.appendChild(label);
        el.appendChild(link);
      }).catch(function(){});
  })(slots[i]);
})();\n`;
}
