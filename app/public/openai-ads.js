!function(w,d,s,u){if(w.oaiq)return;var q=function(){q.q.push(arguments)};q.q=[];w.oaiq=q;var j=d.createElement(s);j.async=1;j.src=u;var f=d.getElementsByTagName(s)[0];f.parentNode.insertBefore(j,f)}(window,document,"script","https://bzrcdn.openai.com/sdk/oaiq.min.js");
oaiq("init",{pixelId:"7eEP1tzo8GR7Jsz62QMrtb",debug:false});
(function(){
  function once(key,event,data){
    try{if(sessionStorage.getItem(key))return;sessionStorage.setItem(key,"1")}catch(e){}
    oaiq("measure",event,data);
  }
  var params=new URLSearchParams(location.search);
  var paymentStatus=params.get("status")||params.get("collection_status")||params.get("resultado");
  var checkoutRef=params.get("ref")||params.get("external_reference");
  if(checkoutRef&&["approved","sucesso"].includes(paymentStatus)){
    once("oai_order_"+checkoutRef,"order_created",{type:"contents"});
  }
  var nativeFetch=window.fetch&&window.fetch.bind(window);
  if(nativeFetch)window.fetch=async function(input,init){
    var response=await nativeFetch(input,init);
    try{
      var url=typeof input==="string"?input:(input&&input.url)||"";
      var method=String((init&&init.method)||(input&&input.method)||"GET").toUpperCase();
      if(response.ok&&method==="PUT"&&/\/api\/store-portal\/[^/]+\/seller-profile(?:\?|$)/.test(url)){
        once("oai_seller_registration","registration_completed",{type:"customer_action"});
      }
      if(response.ok&&method==="GET"&&checkoutRef&&/\/api\/marketplace\/orders(?:\?|$)/.test(url)){
        response.clone().json().then(function(payload){
          var order=(payload.orders||[]).find(function(item){return item.reference===checkoutRef});
          if(order&&order.payment_status==="approved"){
            var data={type:"contents"};
            if(Number.isInteger(order.total_cents)){data.amount=order.total_cents;data.currency="BRL"}
            if(Array.isArray(order.items))data.contents=order.items.map(function(item){
              return {id:String(item.product_id||item.id||item.product_name),name:String(item.product_name||"Produto"),content_type:"product",quantity:Math.max(1,Math.trunc(Number(item.quantity)||1))};
            });
            once("oai_order_"+checkoutRef,"order_created",data);
          }
        }).catch(function(){});
      }
    }catch(e){}
    return response;
  };
})();
