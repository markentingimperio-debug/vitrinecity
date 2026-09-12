// Movement is local presentation only: this module never grants rewards or sends actions.
export const FARM_BEDS=Object.freeze(Array.from({length:12},(_,i)=>Object.freeze({x:-9.2+i%3*3.12,z:-.35+Math.floor(i/3)*2.83,halfWidth:1.25,halfDepth:1.05})));
const rect=(x0,z0,x1,z1)=>({kind:'rect',x0,z0,x1,z1});
export const FARM_OBSTACLES=Object.freeze([
  ...FARM_BEDS.map(p=>rect(p.x-p.halfWidth,p.z-p.halfDepth,p.x+p.halfWidth,p.z+p.halfDepth)),
  rect(-10,-9.7,-4.4,-3.85),rect(2.65,-10.8,7.6,-7.22),rect(-2.15,-9,-.85,-7.65),
  {kind:'ellipse',x:7.7,z:-1.6,rx:3.56,rz:2.66},rect(4.35,1.05,6.68,4.03),
  rect(3.73,4.3,3.87,10),rect(3.8,9.93,10.6,10.07),rect(10.53,4.3,10.67,10),rect(8.8,4.23,10.6,4.37),
  ...[6,10].flatMap(x=>[6,8.4].map(z=>rect(x-.12,z-.12,x+.12,z+.12))),rect(6.5,5.55,9.5,6.25),
  {kind:'ellipse',x:5.6,z:8.45,rx:.83,rz:1.2}
].map(Object.freeze));
const BOUNDS={x0:-11.45,x1:11.42,z0:-11.16,z1:11.18};
export function farmWalkable(p,radius=.22){
  if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.z)||p.x<BOUNDS.x0+radius||p.x>BOUNDS.x1-radius||p.z<BOUNDS.z0+radius||p.z>BOUNDS.z1-radius)return false;
  return !FARM_OBSTACLES.some(o=>o.kind==='ellipse'?((p.x-o.x)/(o.rx+radius))**2+((p.z-o.z)/(o.rz+radius))**2<=1:p.x>=o.x0-radius&&p.x<=o.x1+radius&&p.z>=o.z0-radius&&p.z<=o.z1+radius);
}
export function farmInteractionPoint(target){
  if(target?.kind==='plot'&&Number.isInteger(target.plot)&&FARM_BEDS[target.plot]){const p=FARM_BEDS[target.plot];return{x:p.x,z:p.z+1.43};}
  if(target?.kind==='animal'&&target.animal==='chicken')return{x:3.1,z:2.6};
  if(target?.kind==='animal'&&target.animal==='cow')return{x:4.45,z:8.35};
  return null;
}
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
function clearSegment(a,b,radius){
  if(!farmWalkable(b,radius))return false;
  for(const o of FARM_OBSTACLES){
    if(o.kind==='ellipse'){const ax=(a.x-o.x)/(o.rx+radius),az=(a.z-o.z)/(o.rz+radius),dx=(b.x-a.x)/(o.rx+radius),dz=(b.z-a.z)/(o.rz+radius),t=Math.max(0,Math.min(1,-(ax*dx+az*dz)/(dx*dx+dz*dz||1)));if((ax+dx*t)**2+(az+dz*t)**2<=1)return false;continue;}
    let low=0,high=1,hit=true;for(const [start,delta,min,max] of [[a.x,b.x-a.x,o.x0-radius,o.x1+radius],[a.z,b.z-a.z,o.z0-radius,o.z1+radius]]){if(Math.abs(delta)<1e-10){if(start<min||start>max){hit=false;break;}}else{const t0=(min-start)/delta,t1=(max-start)/delta;low=Math.max(low,Math.min(t0,t1));high=Math.min(high,Math.max(t0,t1));if(low>high){hit=false;break;}}}if(hit)return false;
  }return true;
}
class Heap{
  list=[];push(v){const a=this.list;a.push(v);let i=a.length-1;while(i){const p=(i-1)>>1;if(a[p].f<=v.f)break;a[i]=a[p];i=p;}a[i]=v;}
  pop(){const a=this.list,first=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1].f<a[c].f)c++;if(a[c].f>=last.f)break;a[i]=a[c];i=c;}a[i]=last;}return first;}
}
export function farmRoute(start,goal,radius=.22){
  if(!farmWalkable(start,radius)||!farmWalkable(goal,radius))return null;if(clearSegment(start,goal,radius))return[{...goal}];
  const step=.18,min=-11.2,size=126,point=(x,z)=>({x:min+x*step,z:min+z*step}),key=(x,z)=>z*size+x;
  function nearby(p){const x=Math.round((p.x-min)/step),z=Math.round((p.z-min)/step),found=[];for(let dx=-3;dx<=3;dx++)for(let dz=-3;dz<=3;dz++){const ix=x+dx,iz=z+dz;if(ix<0||iz<0||ix>=size||iz>=size)continue;const q=point(ix,iz);if(farmWalkable(q,radius)&&clearSegment(p,q,radius))found.push({x:ix,z:iz,p:q,d:distance(p,q)});}return found.sort((a,b)=>a.d-b.d)[0];}
  const a=nearby(start),b=nearby(goal);if(!a||!b)return null;const heap=new Heap(),nodes=new Map(),closed=new Set(),first={...a,g:0,f:distance(a.p,b.p),parent:null};nodes.set(key(a.x,a.z),first);heap.push(first);let end=null,iterations=0;
  while(heap.list.length&&iterations++<18000){const n=heap.pop(),id=key(n.x,n.z);if(closed.has(id))continue;closed.add(id);if(n.x===b.x&&n.z===b.z){end=n;break;}for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){const x=n.x+dx,z=n.z+dz,k=key(x,z);if(x<0||z<0||x>=size||z>=size||closed.has(k))continue;const p=point(x,z);if(!farmWalkable(p,radius)||!clearSegment(n.p,p,radius))continue;const g=n.g+Math.hypot(dx,dz)*step;if(nodes.has(k)&&nodes.get(k).g<=g)continue;const node={x,z,p,g,f:g+distance(p,b.p),parent:n};nodes.set(k,node);heap.push(node);}}
  if(!end)return null;const route=[{...goal}];for(let n=end;n;n=n.parent)route.unshift(n.p);const compact=[];let current=start;for(let i=0;i<route.length;){let furthest=i;for(let j=i+1;j<route.length;j++){if(clearSegment(current,route[j],radius))furthest=j;else break;}compact.push(route[furthest]);current=route[furthest];i=furthest+1;}return compact;
}
export function createFarmWalker({position={x:1.1,z:10.5},speed=2.65,radius=.22}={}){
  if(!farmWalkable(position,radius))throw Error('farm_walk_start_blocked');const p={...position};let route=[],moving=false,heading=0;
  function stop(){route=[];moving=false;}
  function moveTo(goal){const next=farmRoute(p,goal,radius);if(!next){stop();return false;}route=next;return true;}
  function step(dt,input={x:0,z:0}){const seconds=Math.min(.08,Math.max(0,Number(dt)||0));let remaining=speed*seconds;moving=false;const length=Math.hypot(input.x||0,input.z||0);if(length){route=[];const dx=input.x/length,dz=input.z/length;while(remaining>.0001){const s=Math.min(.08,remaining),next={x:p.x+dx*s,z:p.z+dz*s};if(clearSegment(p,next,radius)){p.x=next.x;p.z=next.z;moving=true;}else{const nx={x:next.x,z:p.z};if(clearSegment(p,nx,radius)){moving||=Math.abs(nx.x-p.x)>.0001;p.x=nx.x;}const nz={x:p.x,z:next.z};if(clearSegment(p,nz,radius)){moving||=Math.abs(nz.z-p.z)>.0001;p.z=nz.z;}}remaining-=s;}if(moving)heading=Math.atan2(dx,dz);
    }else while(remaining>.0001&&route.length){const goal=route[0],d=distance(p,goal);if(d<.00001){p.x=goal.x;p.z=goal.z;route.shift();continue;}const s=Math.min(.08,remaining,d),dx=(goal.x-p.x)/d,dz=(goal.z-p.z)/d,next={x:p.x+dx*s,z:p.z+dz*s};if(!farmWalkable(next,radius)){stop();break;}p.x=next.x;p.z=next.z;heading=Math.atan2(dx,dz);moving=true;remaining-=s;if(s===d){p.x=goal.x;p.z=goal.z;route.shift();}}
    return{position:{...p},moving,heading,arrived:route.length===0};
  }
  return{get position(){return{...p};},get moving(){return moving;},get heading(){return heading;},get hasRoute(){return route.length>0;},moveTo,step,stop,near(target,maxDistance=.7){const q=farmInteractionPoint(target);return Boolean(q&&distance(p,q)<=maxDistance);}};
}
