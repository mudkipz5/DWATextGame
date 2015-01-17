/* DWA Text Adventure
Copyright (C) 2015 Pony in a Box Productions

This program is free software; you can redistribute it and/or
modify it under the terms of the GNU General Public License
as published by the Free Software Foundation; either version 2
of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

Full license: http://www.gnu.org/licenses/gpl-2.0.html */

$(function () {
	$.get( "data/story.dat", function( data ) {
		$( "#story" ).html(data);
		new DedalusWeb({
			domSource         : $('#story'),
			domTarget         : $('#host'),
			titleTarget       : $('#title'),
			inventoryTarget   : $('#inventoryHost'),
			interactionTarget : $('#interactionHost'),
			undoTarget        : $('#undoHost'),
			undoStageTarget   : $('#undoStageHost'),
			saveTarget        : $('#saveHost'),
			restoreTarget     : $('#restoreHost'),
			resetTarget       : $('#resetHost'),
		});
		$('#version').text("v0.2.1 Alpha");
	});
});