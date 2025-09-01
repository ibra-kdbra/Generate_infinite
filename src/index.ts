import Game from './Game/Game'

const gameElement = document.querySelector('.game')
if (gameElement) {
    new Game(gameElement)
}
