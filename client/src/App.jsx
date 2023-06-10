import REACT from "react"
import Home from "./pages/Home";
import Customizer from "./pages/Customizer";
import Canvas from "./canvas/index"

const App =()=>{
  return(
      <div>
        <Home/>
        <Canvas/>
        <Customizer/>
      </div>
    
  )
}

export default App;