export default function SpinnerLoader({ size = 40, color = "#3B82F6" }) {
return ( <div className="flex justify-center items-center h-full w-full">
<div
className="animate-spin rounded-full border-t-4 border-b-4"
style={{
width: `${size}px`,
height: `${size}px`,
borderColor: `${color} transparent ${color} transparent`,
}}
></div> </div>
);
}
